import { useReviewContext } from '../../../review/context';
import { handleTabKeys } from '../../../review/utils';
import { Settings } from '../Settings';

export function Header() {
  const v = useReviewContext();
  const datasetTabDisabled = v.busy || v.session.analysisOnly || !v.state?.datasetLoaded;
  return (
    <header className='appHeader'>
      <h1>LoRA 数据工作台</h1>
      <nav className='tabs' role='tablist' aria-label='审核阶段' onKeyDown={handleTabKeys}>
        {!v.session.analysisOnly ? (
          <button
            id='homeTab'
            role='tab'
            aria-selected={v.stage === 'home'}
            aria-controls='homeView'
            className={v.stage === 'home' ? 'active' : ''}
            disabled={v.busy}
            onClick={() => v.handleStage('home')}
            tabIndex={v.stage === 'home' ? 0 : -1}
          >
            主页
          </button>
        ) : null}
        <button
          id='cropTab'
          role='tab'
          aria-selected={v.stage === 'crop'}
          aria-controls='cropView'
          className={v.stage === 'crop' ? 'active' : ''}
          disabled={datasetTabDisabled}
          onClick={() => v.handleStage('crop')}
          tabIndex={v.stage === 'crop' ? 0 : -1}
        >
          裁切
        </button>
        <button
          id='taggingTab'
          role='tab'
          aria-selected={v.stage === 'tagging'}
          aria-controls='taggingView'
          className={v.stage === 'tagging' ? 'active' : ''}
          disabled={datasetTabDisabled}
          onClick={() => v.handleStage('tagging')}
          tabIndex={v.stage === 'tagging' ? 0 : -1}
        >
          打标
        </button>
        <button
          id='tagTab'
          role='tab'
          aria-selected={v.stage === 'tag'}
          aria-controls='tagView'
          tabIndex={v.stage === 'tag' ? 0 : -1}
          disabled={datasetTabDisabled}
          onClick={() => v.handleStage('tag')}
          className={v.stage === 'tag' ? 'active' : ''}
        >
          标签编辑
        </button>
        <button
          id='auditTab'
          role='tab'
          aria-selected={v.stage === 'audit'}
          aria-controls='auditView'
          tabIndex={v.stage === 'audit' ? 0 : -1}
          disabled={datasetTabDisabled}
          onClick={() => v.handleStage('audit')}
          className={v.stage === 'audit' ? 'active' : ''}
        >
          标签检查
        </button>
        <button
          id='toolsTab'
          role='tab'
          aria-selected={v.stage === 'tools'}
          aria-controls='toolsView'
          tabIndex={v.stage === 'tools' ? 0 : -1}
          disabled={v.busy}
          onClick={() => v.handleStage('tools')}
          className={v.stage === 'tools' ? 'active' : ''}
        >
          数据集工具
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
      {v.session.settingsEnabled ? <Settings /> : null}
      <div className='stageActions' hidden={v.stage === 'home'}>
        <span id='stageStatus'>{v.stageStatus}</span>
        <button
          id='exportDataset'
          className='primary'
          hidden={v.stage !== 'tag' && v.stage !== 'audit'}
          disabled={v.processing || !v.state?.datasetLoaded}
          onClick={() => v.handleAction('exportDataset')}
        >
          导出训练集
        </button>
        <button
          id='openWorkdir'
          title='在文件资源管理器中打开当前图片工作目录'
          disabled={v.processing || !v.state?.datasetLoaded}
          onClick={() => v.handleAction('openWorkdir')}
        >
          打开工作目录
        </button>
        <button
          id='refresh'
          title='同步目录文件和已保存记录，不执行图片处理'
          disabled={v.processing || !v.state?.datasetLoaded}
          onClick={() => v.handleAction('refresh')}
        >
          刷新
        </button>
      </div>
    </header>
  );
}
