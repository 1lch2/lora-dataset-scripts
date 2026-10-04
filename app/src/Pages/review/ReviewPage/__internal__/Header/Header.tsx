import { useReviewContext } from '../../../context';
import { handleTabKeys } from '../../../utils';

export function Header() {
  const v = useReviewContext();
  return (
    <>
      <header className='appHeader'>
        <h1>训练集审核</h1>
        <nav className='tabs' role='tablist' aria-label='审核阶段' onKeyDown={handleTabKeys}>
          <button
            id='cropTab'
            role='tab'
            aria-selected={v.stage === 'crop'}
            aria-controls='cropView'
            className={v.stage === 'crop' ? 'active' : ''}
            disabled={v.busy || v.session.analysisOnly}
            onClick={() => v.handleStage('crop')}
            tabIndex={v.stage === 'crop' ? 0 : -1}
          >
            裁切
          </button>
          <button
            id='tagTab'
            role='tab'
            aria-selected={v.stage === 'tag'}
            aria-controls='tagView'
            tabIndex={v.stage === 'tag' ? 0 : -1}
            disabled={v.busy || v.session.analysisOnly}
            onClick={() => v.handleStage('tag')}
            className={v.stage === 'tag' ? 'active' : ''}
          >
            标签
          </button>
          <button
            id='analysisTab'
            role='tab'
            aria-selected={v.stage === 'analysis'}
            aria-controls='analysisView'
            tabIndex={v.stage === 'analysis' ? 0 : -1}
            disabled={v.busy}
            onClick={() => v.handleStage('analysis')}
            className={v.stage === 'analysis' ? 'active' : ''}
          >
            数据集分析
          </button>
          <button
            id='compositeTab'
            role='tab'
            aria-selected={v.stage === 'composite'}
            aria-controls='compositeView'
            tabIndex={v.stage === 'composite' ? 0 : -1}
            disabled={v.busy}
            onClick={() => v.handleStage('composite')}
            className={v.stage === 'composite' ? 'active' : ''}
          >
            复合打标
          </button>
          <button
            id='loraTab'
            role='tab'
            aria-selected={v.stage === 'lora'}
            aria-controls='loraView'
            tabIndex={v.stage === 'lora' ? 0 : -1}
            disabled={v.busy}
            onClick={() => v.handleStage('lora')}
            className={v.stage === 'lora' ? 'active' : ''}
          >
            LoRA 文件
          </button>
        </nav>
        <div className='stageActions'>
          <span id='stageStatus'>{v.stageStatus}</span>
          <button
            id='startTag'
            className={v.stage === 'tag' ? '' : 'primary'}
            disabled={v.processing || !v.ready}
            onClick={() => v.handleAction('startTag')}
            hidden={v.stage === 'tag' && !v.untagged && !['running', 'failed'].includes(v.job.status)}
          >
            {v.startLabel}
          </button>
          <button
            id='exportDataset'
            className='primary'
            hidden={v.stage !== 'tag'}
            disabled={false}
            onClick={() => v.handleAction('exportDataset')}
          >
            导出训练集
          </button>
          <button
            id='openWorkdir'
            title='在文件资源管理器中打开当前图片工作目录'
            disabled={v.busy}
            onClick={() => v.handleAction('openWorkdir')}
          >
            打开工作目录
          </button>
          <button
            id='refresh'
            title='重新读取已保存的数据'
            disabled={v.busy}
            onClick={() => v.handleAction('refresh')}
          >
            刷新
          </button>
        </div>
      </header>
      <div id='notification' hidden={!v.notice.text}>
        <p id='message' role='status' aria-live='polite' className={v.notice.error ? 'error' : ''}>
          {v.notice.text}
        </p>
        <button
          id='dismissMessage'
          aria-label='关闭提示'
          disabled={v.busy}
          onClick={() => v.handleAction('dismissMessage')}
        >
          ×
        </button>
      </div>
    </>
  );
}
