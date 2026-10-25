import { useEffect, useState } from 'react';
import type { Box } from '../../../../../api/types';
import { useReviewContext } from '../../../context';
import { CROP_NAMES, imageUrl } from '../../../utils';
import { CropCanvas } from '../../../CropCanvas';

function formatScaleOption(label: string, scale: number, size?: [number, number]) {
  if (!size) return label;
  const dimensions = size.map((dimension) => {
    if (scale === 1) return dimension;
    const scaled = (dimension * scale) / 8;
    const lower = Math.floor(scaled);
    // 与后端 Python round 一致，恰好位于中点时取偶数，再对齐到 8 的倍数。
    const rounded = scaled - lower === 0.5 ? lower + (lower % 2) : Math.round(scaled);
    return rounded * 8;
  });
  return `${label}（${dimensions[0]} × ${dimensions[1]}）`;
}

export function CropEditor() {
  const v = useReviewContext();
  const persons = v.source?.detection?.persons || [];
  const [subjectCropSourceId, setSubjectCropSourceId] = useState<string>();
  const [subjectBox, setSubjectBox] = useState<Box | null>(null);
  const subjectCropping = !!v.source && subjectCropSourceId === v.source.id;
  const imageSize = subjectCropping ? v.source?.original_size : v.source?.working_size;
  const allowProcessing = v.state?.config.crop_mode !== 'prepared' || v.source?.manual_processing;
  useEffect(() => {
    setSubjectCropSourceId(undefined);
    setSubjectBox(null);
  }, [v.source?.id, v.stage]);
  function handleStartSubjectCrop() {
    if (!v.source) return;
    v.setCandidateId('full');
    setSubjectCropSourceId(v.source.id);
    setSubjectBox(null);
  }
  function handleCancelSubjectCrop() {
    setSubjectCropSourceId(undefined);
    setSubjectBox(null);
  }
  async function handleApplySubjectCrop() {
    if (!subjectBox) return;
    if (await v.replaceSourceImage('crop_subject', subjectBox)) handleCancelSubjectCrop();
  }
  async function handleRestoreOriginal() {
    if (await v.replaceSourceImage('restore_original')) handleCancelSubjectCrop();
  }
  return (
    <main id='cropView' role='tabpanel' aria-labelledby='cropTab' hidden={v.stage !== 'crop'}>
      <section className='editor' hidden={!v.source}>
        <div className='editorHeading'>
          <div className='sourceHeadingInfo'>
            <h2 id='sourceName' title={v.source ? `${v.source.group} / ${v.source.relative}` : ''}>
              {v.source ? `${v.source.group} / ${v.source.relative}` : '选择图片'}
            </h2>
            {imageSize ? (
              <span className='sourceResolution' aria-label='当前图片分辨率'>
                {imageSize[0]} × {imageSize[1]}
              </span>
            ) : null}
          </div>
          <button
            id='focusCrop'
            aria-pressed={v.focusCrop}
            disabled={v.busy}
            onClick={() => v.handleAction('focusCrop')}
          >
            {v.focusCrop ? '退出专注' : '专注裁切'}
          </button>
        </div>
        <div className='images'>
          <figure className='workingFigure'>
            {subjectCropping ? <figcaption>裁切主体 · 在完整图上拖出主体范围</figcaption> : null}
            <CropCanvas
              image={
                v.source?.working
                  ? imageUrl(v.source, subjectCropping ? 'original' : 'working', v.state!.updated_at)
                  : ''
              }
              box={subjectCropping ? subjectBox : v.box}
              disabled={v.processing || (!subjectCropping && v.full)}
              visible={v.stage === 'crop'}
              onChange={subjectCropping ? setSubjectBox : v.setBox}
            />
          </figure>
        </div>
        <aside className='cropInspector panelScroll' aria-label='裁切设置'>
          <section className='cropParts'>
            <h3>裁切部位</h3>
            <p id='cropProgress' className='hint'>
              {v.source?.candidates.some((c) => c.status === 'pending')
                ? `${v.source.candidates.filter((c) => c.box).length - v.source.candidates.filter((c) => c.status === 'pending').length} / ${v.source.candidates.filter((c) => c.box).length} 个已处理 · 剩余 ${v.source.candidates.filter((c) => c.status === 'pending').length} 个`
                : '本图无待审裁框'}
            </p>
            <div id='candidates'>
              {v.source?.candidates.map((c) => (
                <div className='candidateRow' key={c.id}>
                  <button
                    data-candidate={c.id}
                    className={c.id === v.candidate?.id ? 'active' : ''}
                    disabled={v.busy || subjectCropping}
                    onClick={() => {
                      v.setCandidateId(c.id);
                      v.setBox(c.box ? [...c.box] : null);
                    }}
                  >{`${[c.kind, ...(c.aliases || [])].map((k) => CROP_NAMES[k]).join(' / ')} · ${c.kind === 'full' ? '固定保留' : ({ pending: '待审', accepted: '已接受' } as Record<string, string>)[c.status]}`}</button>
                  {c.kind === 'full' ? (
                    <button
                      id='cropSubject'
                      disabled={v.processing || subjectCropping || !v.source?.original_size}
                      onClick={handleStartSubjectCrop}
                    >
                      裁切主体
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            {v.source?.original_backup ? (
              <button
                id='restoreOriginal'
                disabled={v.processing}
                onClick={() => void handleRestoreOriginal()}
              >
                恢复原始图
              </button>
            ) : null}
            {subjectCropping ? (
              <p className='hint'>
                应用后以选中范围替换完整图，并清空本图已有裁框、识别结果和标签。原图可恢复。
              </p>
            ) : null}
            <button
              id='newCrop'
              disabled={v.processing || subjectCropping}
              onClick={() => v.handleAction('newCrop')}
              className={v.candidateId === null ? 'active' : ''}
            >
              ＋ 新建裁框
            </button>
            <button
              id='acceptSource'
              disabled={
                v.processing || subjectCropping || !v.source?.candidates.some((c) => c.status === 'pending')
              }
              onClick={() => v.handleAction('acceptSource')}
            >
              接受本图全部待审裁框
            </button>
          </section>
          <details className='imageSettings'>
            <summary>倍率与主体</summary>
            <label>
              工作图倍率
              <select
                id='scale'
                value={v.fields.scale}
                onChange={(event) => v.handleField('scale', event.target.value)}
              >
                <option value='1'>{formatScaleOption('不放大', 1, v.source?.original_size)}</option>
                <option value='1.5'>{formatScaleOption('1.5 倍', 1.5, v.source?.original_size)}</option>
                <option value='2'>{formatScaleOption('2 倍', 2, v.source?.original_size)}</option>
              </select>
            </label>
            <button
              id='setScale'
              disabled={v.processing || subjectCropping || !allowProcessing}
              onClick={() => v.handleAction('setScale')}
            >
              仅更新此图倍率
            </button>
            <button
              id='detectSource'
              disabled={v.processing || subjectCropping || !v.source || !allowProcessing}
              onClick={() => v.handleAction('detectSource')}
            >
              识别此图主体
            </button>
            {persons.length > 0 ? (
              <>
                <label>
                  主体
                  <select
                    id='person'
                    value={v.fields.person}
                    onChange={(event) => v.handleField('person', event.target.value)}
                  >
                    {persons.map((p, i) => (
                      <option key={i} value={i}>{`人物 ${i + 1} (${p.score.toFixed(2)})`}</option>
                    ))}
                  </select>
                </label>
                <button
                  id='setPerson'
                  disabled={v.processing || subjectCropping}
                  onClick={() => v.handleAction('setPerson')}
                >
                  生成主体裁框
                </button>
              </>
            ) : (
              <p className='hint'>暂无主体识别结果，请先识别此图主体。</p>
            )}
          </details>
          <details>
            <summary>检测提示</summary>
            <p id='notes' className='hint'>
              {v.source?.error || (v.source?.notes || []).join('；')}
            </p>
          </details>
          <figure className='originalFigure'>
            <figcaption>
              {v.source?.original_backup ? '主体完整图 · 固定保留' : '完整原图 · 固定保留'}
            </figcaption>
            <button
              id='originalPreview'
              className='imageButton'
              aria-label='查看完整原图'
              disabled={v.busy}
              onClick={() => {
                if (v.source?.working) v.setPreviewImage(imageUrl(v.source, 'original', v.state!.updated_at));
              }}
            >
              <img
                id='original'
                alt='完整原图'
                src={v.source?.working ? imageUrl(v.source, 'original', v.state!.updated_at) : undefined}
              />
            </button>
          </figure>
        </aside>
        <div className='cropActions'>
          <div className='cropSize'>
            <strong id='dimensions'>
              {subjectCropping
                ? subjectBox
                  ? `${Math.round(subjectBox[2]) - Math.round(subjectBox[0])} × ${Math.round(subjectBox[3]) - Math.round(subjectBox[1])} · 主体范围`
                  : '在完整图上拖出主体范围'
                : v.box
                  ? `${v.width} × ${v.height} · ${(v.width * v.height).toLocaleString()} 像素`
                  : v.full
                    ? '完整原图 · 固定保留'
                    : '在工作图上拖出矩形'}
            </strong>
            <span id='areaStatus' className={v.box && !v.enough ? 'bad' : ''}>
              {!subjectCropping && v.box
                ? v.enough
                  ? '✓ 达到像素下限'
                  : `不足 ${v.state?.config.min_area.toLocaleString()} 像素，请扩大裁框`
                : ''}
            </span>
          </div>
          <div className='toolbar' role='group' aria-label='当前裁框操作'>
            {subjectCropping ? (
              <>
                <button disabled={v.processing} onClick={handleCancelSubjectCrop}>
                  取消主体裁切
                </button>
                <button
                  id='applySubjectCrop'
                  className='primary'
                  disabled={
                    v.processing ||
                    !subjectBox ||
                    Math.round(subjectBox[2]) <= Math.round(subjectBox[0]) ||
                    Math.round(subjectBox[3]) <= Math.round(subjectBox[1])
                  }
                  onClick={() => void handleApplySubjectCrop()}
                >
                  应用主体裁切
                </button>
              </>
            ) : (
              <>
                <button
                  id='saveCrop'
                  disabled={v.processing || !v.box || v.full}
                  onClick={() => v.handleAction('saveCrop')}
                >
                  保存修改
                </button>
                <button
                  id='deleteCrop'
                  className='destructive'
                  disabled={v.processing || v.full || (!v.candidate && !v.box)}
                  onClick={() => v.handleAction('deleteCrop')}
                >
                  删除裁切
                </button>
                <button
                  id='acceptCrop'
                  className='primary'
                  disabled={v.processing || !v.enough || v.full}
                  onClick={() => v.handleAction('acceptCrop')}
                >
                  接受并继续
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
