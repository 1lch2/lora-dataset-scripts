import { useAnalysis } from '../useAnalysis';
import { fmt, pct, ratio } from '../utils';
import { Histogram } from './__internal__/Histogram';
import { Metrics } from './__internal__/Metrics';
import { Similarity } from './__internal__/Similarity';
import type { AnalysisViewProps } from './types';

export function AnalysisView({ token, active }: AnalysisViewProps) {
  const a = useAnalysis(token, active);
  return (
    <main id='analysisView' role='tabpanel' aria-labelledby='analysisTab' hidden={!active}>
      <section className='analysisSetup'>
        <h2>数据集特性分析</h2>
        <p className='hint'>
          本地只读分析 · 不上传图片 · 不展示缩略图 · 不修改源文件。只有点击开始后才读取指定目录。
        </p>
        <form id='analysisForm' onSubmit={a.handleSubmit}>
          <label>
            图片目录
            <input
              id='analysisDirectory'
              required={true}
              placeholder='粘贴本地目录的完整路径'
              autoComplete='off'
              value={a.fields.analysisDirectory}
              onChange={(event) => a.setField('analysisDirectory', event.target.value)}
            />
          </label>
          <div className='analysisOptions'>
            <label className='checkLabel'>
              <input
                id='analysisRecursive'
                type='checkbox'
                checked={a.checks.analysisRecursive}
                onChange={(event) => {
                  const checked = event.target.checked;
                  a.setChecks((previous) => ({ ...previous, analysisRecursive: checked }));
                }}
              />
              包含子目录
            </label>
            <label className='checkLabel'>
              <input
                id='analysisPose'
                type='checkbox'
                checked={a.checks.analysisPose}
                onChange={(event) => {
                  const checked = event.target.checked;
                  a.setChecks((previous) => ({ ...previous, analysisPose: checked }));
                }}
              />
              人物与姿势（本地缓存模型）
            </label>
            <label className='checkLabel'>
              <input
                id='analysisCaptions'
                type='checkbox'
                checked={a.checks.analysisCaptions}
                onChange={(event) => {
                  const checked = event.target.checked;
                  a.setChecks((previous) => ({ ...previous, analysisCaptions: checked }));
                }}
              />
              同名 TXT 标签分布
            </label>
          </div>
          <details>
            <summary>分析设置</summary>
            <div className='analysisSettings'>
              <label>
                相似比较图片上限
                <input
                  id='analysisLimit'
                  type='number'
                  min='2'
                  max='5000'
                  required={true}
                  value={a.fields.analysisLimit}
                  onChange={(event) => a.setField('analysisLimit', event.target.value)}
                />
              </label>
              <label>
                姿势距离阈值（越小越严格）
                <input
                  id='analysisPoseThreshold'
                  type='number'
                  min='0.01'
                  max='1'
                  step='0.01'
                  required={true}
                  value={a.fields.analysisPoseThreshold}
                  onChange={(event) => a.setField('analysisPoseThreshold', event.target.value)}
                />
              </label>
              <label>
                dHash 汉明距离阈值
                <input
                  id='analysisHashThreshold'
                  type='number'
                  min='0'
                  max='16'
                  required={true}
                  value={a.fields.analysisHashThreshold}
                  onChange={(event) => a.setField('analysisHashThreshold', event.target.value)}
                />
              </label>
              <label>
                可选模型缓存 HF_HOME
                <input
                  id='analysisCache'
                  placeholder='留空使用当前环境缓存'
                  autoComplete='off'
                  value={a.fields.analysisCache}
                  onChange={(event) => a.setField('analysisCache', event.target.value)}
                />
              </label>
            </div>
            <p className='hint'>
              基础统计覆盖全部图片；相似度最多抽取指定数量，按排序后等间隔抽样。姿势仅使用已有模型，缺少模型时跳过并提示。标签可能含敏感文本，勾选后会出现在报告中。
            </p>
          </details>
          <div className='toolbar'>
            <button
              id='analysisStart'
              className='primary'
              type='submit'
              disabled={a.running || a.startPending}
            >
              开始分析
            </button>
            <button id='analysisCancel' type='button' disabled={!a.running} onClick={a.handleCancel}>
              取消
            </button>
            <progress
              id='analysisProgress'
              hidden={!a.running}
              aria-label='分析进度'
              max={a.status?.total || undefined}
              value={a.status?.total ? a.status.done : undefined}
            ></progress>
            <span id='analysisStatus' role='status' aria-live='polite'>
              {a.statusText}
            </span>
          </div>
        </form>
      </section>
      <section id='analysisResults' hidden={!a.report}>
        <div className='analysisReportHeading'>
          <h2>统计报告</h2>
          <div className='toolbar'>
            <button id='analysisJson' onClick={a.handleJson}>
              导出 JSON
            </button>
            <button id='analysisCsv' onClick={a.handleCsv}>
              导出逐图 CSV
            </button>
            <label className='baselineLabel'>
              载入对照报告
              <input
                id='analysisBaseline'
                type='file'
                accept='.json,application/json'
                onChange={a.handleBaseline}
                ref={a.baselineRef}
              />
            </label>
            <button id='analysisClearBaseline' hidden={!a.baseline} onClick={a.handleClearBaseline}>
              清除对照
            </button>
          </div>
        </div>
        <p id='analysisOverview'>
          {a.report
            ? `发现 ${a.report.total} 张 · 成功 ${a.report.successful} · 失败 ${a.report.failed}。报告仅存本次服务会话，需保留请导出。`
            : ''}
        </p>
        <div id='analysisWarnings' role='status'>
          {a.report?.warnings.map((w, i) => (
            <p className='bad' key={i}>
              {w}
            </p>
          ))}
          {a.baseline && JSON.stringify(a.report?.settings) !== JSON.stringify(a.baseline.settings) ? (
            <p className='bad'>
              对照报告的分析设置不同，尤其注意姿势覆盖率、抽样上限及阈值，不能直接比较相似对数。
            </p>
          ) : null}
        </div>
        <p className='hint'>
          亮度为 sRGB 加权值，不代表物理曝光；接近白色也可能来自背景或画风。以下分布按图片等权汇总，不推断
          LoRA 效果的单一原因。
        </p>
        <div className='analysisChart'>
          <h3>像素亮度分布 · 每张图片等权</h3>
          <Histogram
            id='analysisPixelHistogram'
            values={a.report?.pixel_histogram || []}
            edges={Array.from({ length: 33 }, (_, i) => i / 32)}
            fraction
          />
          <p className='hint'>左：黑 → 右：白；鼠标悬停可查看区间占比。</p>
        </div>
        {a.report ? <Metrics report={a.report} baseline={a.baseline} /> : null}
        {a.report ? <Similarity report={a.report} /> : null}
        <section id='analysisCaptionSection' className='analysisSection' hidden={!a.report?.captions.enabled}>
          <h3>标签覆盖</h3>
          <p id='analysisCaptionSummary'>
            {a.report
              ? `可读取同名 TXT ${a.report.captions.read}/${a.report.successful}，${a.report.captions.tags.length} 个不同标签。频率按含该标签的图片数统计；只展示前 100 个。`
              : ''}
          </p>
          <div id='analysisCaptionTags'>
            {a.report?.captions.tags.slice(0, 100).map(([tag, n]) => (
              <span
                className='analysisTag'
                key={tag}
              >{`${tag} · ${n} (${ratio(n, a.report!.captions.read)})`}</span>
            ))}
          </div>
        </section>
        <section className='analysisSection'>
          <h3>逐图指标与筛选</h3>
          <div className='analysisSettings'>
            <label>
              文件名
              <input
                id='analysisSearch'
                type='search'
                placeholder='筛选相对路径'
                value={a.fields.analysisSearch}
                onChange={(event) => a.setField('analysisSearch', event.target.value)}
              />
            </label>
            <label>
              排序
              <select
                id='analysisSort'
                value={a.fields.analysisSort}
                onChange={(event) => a.setField('analysisSort', event.target.value)}
              >
                <option value='brightness'>平均亮度</option>
                <option value='highlights'>高光占比</option>
                <option value='shadows'>暗部占比</option>
                <option value='contrast'>对比度</option>
                <option value='saturation'>饱和度</option>
                <option value='detail'>细节强度</option>
                <option value='megapixels'>像素面积</option>
                <option value='person_area'>人物占比</option>
              </select>
            </label>
            <label>
              顺序
              <select
                id='analysisOrder'
                value={a.fields.analysisOrder}
                onChange={(event) => a.setField('analysisOrder', event.target.value)}
              >
                <option value='desc'>降序</option>
                <option value='asc'>升序</option>
              </select>
            </label>
          </div>
          <p
            id='analysisRowCount'
            className='hint'
          >{`${a.filtered.length} 张匹配 · 第 ${a.page + 1}/${a.pages} 页，每页 100 张；完整指标见 CSV。`}</p>
          <div className='analysisTableWrap'>
            <table id='analysisTable'>
              <thead>
                <tr>
                  {[
                    '相对路径',
                    '尺寸',
                    '亮度',
                    '高光',
                    '暗部',
                    '对比',
                    '饱和',
                    '细节',
                    '人物占比',
                    '备注',
                  ].map((label) => (
                    <th scope='col' key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {a.rows.map((r) => (
                  <tr key={r.file}>
                    {[
                      r.file,
                      `${r.width}×${r.height}`,
                      fmt(r.brightness),
                      pct(r.highlights),
                      pct(r.shadows),
                      fmt(r.contrast),
                      fmt(r.saturation),
                      fmt(r.detail),
                      pct(r.person_area),
                      [...r.flags, ...(r.transparency ? ['透明图按中灰合成'] : [])].join('；'),
                    ].map((v, i) => (
                      <td key={i}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className='toolbar'>
            <button id='analysisPrev' disabled={a.page === 0} onClick={() => a.setPage(a.page - 1)}>
              上一页
            </button>
            <button id='analysisNext' disabled={a.page === a.pages - 1} onClick={() => a.setPage(a.page + 1)}>
              下一页
            </button>
          </div>
          <details>
            <summary>读取失败的文件</summary>
            <div id='analysisErrors'>
              {a.report?.errors.map((e, i) => (
                <p key={i}>{`${e.file} · ${e.error}`}</p>
              ))}
            </div>
          </details>
        </section>
      </section>
    </main>
  );
}
