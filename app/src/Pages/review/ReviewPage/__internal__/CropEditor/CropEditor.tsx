import { useReviewContext } from '../../../context';
import { CROP_NAMES, imageUrl } from '../../../utils';
import { CropCanvas } from '../../../CropCanvas';

export function CropEditor() {
  const v = useReviewContext();
  return (
    <main id='cropView' role='tabpanel' aria-labelledby='cropTab' hidden={v.stage !== 'crop'}>
      <section className='editor' hidden={!v.source}>
        <div className='editorHeading'>
          <h2 id='sourceName' title={v.source ? `${v.source.group} / ${v.source.relative}` : ''}>
            {v.source ? `${v.source.group} / ${v.source.relative}` : '选择图片'}
          </h2>
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
            <figcaption>工作图 · 拖动裁框移动，拖动角点缩放</figcaption>
            <CropCanvas
              image={v.source?.working ? imageUrl(v.source, 'working', v.state!.updated_at) : ''}
              box={v.box}
              disabled={v.processing || v.full}
              visible={v.stage === 'crop'}
              onChange={v.setBox}
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
                <button
                  key={c.id}
                  data-candidate={c.id}
                  className={c.id === v.candidate?.id ? 'active' : ''}
                  disabled={v.busy}
                  onClick={() => {
                    v.setCandidateId(c.id);
                    v.setBox(c.box ? [...c.box] : null);
                  }}
                >{`${[c.kind, ...(c.aliases || [])].map((k) => CROP_NAMES[k]).join(' / ')} · ${c.kind === 'full' ? '固定保留' : ({ pending: '待审', accepted: '已接受', rejected: '已拒绝' } as Record<string, string>)[c.status]}`}</button>
              ))}
            </div>
            <button
              id='newCrop'
              disabled={v.processing}
              onClick={() => v.handleAction('newCrop')}
              className={v.candidateId === null ? 'active' : ''}
            >
              ＋ 新建裁框
            </button>
            <button
              id='acceptSource'
              disabled={v.processing || !v.source?.candidates.some((c) => c.status === 'pending')}
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
                <option value='1'>不放大</option>
                <option value='1.5'>1.5 倍</option>
                <option value='2'>2 倍</option>
              </select>
            </label>
            <button
              id='setScale'
              disabled={v.processing || v.state?.config.crop_mode === 'prepared'}
              onClick={() => v.handleAction('setScale')}
            >
              仅更新此图倍率
            </button>
            <label>
              主体
              <select
                id='person'
                value={v.fields.person}
                onChange={(event) => v.handleField('person', event.target.value)}
              >
                {(v.source?.detection?.persons || []).map((p, i) => (
                  <option key={i} value={i}>{`人物 ${i + 1} (${p.score.toFixed(2)})`}</option>
                ))}
              </select>
            </label>
            <button
              id='setPerson'
              disabled={v.processing || !v.source?.detection?.persons.length}
              onClick={() => v.handleAction('setPerson')}
            >
              生成主体裁框
            </button>
          </details>
          <details>
            <summary>检测提示</summary>
            <p id='notes' className='hint'>
              {v.source?.error || (v.source?.notes || []).join('；')}
            </p>
          </details>
          <figure className='originalFigure'>
            <figcaption>完整原图 · 固定保留</figcaption>
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
              {v.box
                ? `${v.width} × ${v.height} · ${(v.width * v.height).toLocaleString()} 像素`
                : v.full
                  ? '完整原图 · 固定保留'
                  : '在工作图上拖出矩形'}
            </strong>
            <span id='areaStatus' className={v.box && !v.enough ? 'bad' : ''}>
              {v.box
                ? v.enough
                  ? '✓ 达到像素下限'
                  : `不足 ${v.state?.config.min_area.toLocaleString()} 像素，请扩大裁框`
                : ''}
            </span>
          </div>
          <div className='toolbar' role='group' aria-label='当前裁框操作'>
            <button
              id='saveCrop'
              disabled={v.processing || !v.box || v.full}
              onClick={() => v.handleAction('saveCrop')}
            >
              保存修改
            </button>
            <button
              id='rejectCrop'
              className='reject'
              disabled={v.processing || !v.candidate || v.full}
              onClick={() => v.handleAction('rejectCrop')}
            >
              拒绝并继续
            </button>
            <button
              id='acceptCrop'
              className='primary'
              disabled={v.processing || !v.enough || v.full}
              onClick={() => v.handleAction('acceptCrop')}
            >
              接受并继续
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
