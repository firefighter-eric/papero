import { BookOpen, FileWarning, LoaderCircle, RefreshCw } from 'lucide-react'

interface Props {
  kind: 'loading' | 'empty' | 'error'
  error?: Error | null
  missing?: boolean
  scope?: 'catalog' | 'paper'
  onRetry?: () => void
}

export function ReaderState({ kind, error, missing, scope = 'catalog', onRetry }: Props) {
  if (kind === 'loading') return <div className="reader-state" role="status" aria-live="polite">
    <LoaderCircle size={28} className="loading-icon" strokeWidth={1.5} aria-hidden="true" />
    <h1>{scope === 'catalog' ? '正在打开论文库' : '正在打开论文'}</h1><p>让理解更近一步。</p>
  </div>

  const setup = kind === 'empty' || missing
  return <div className="reader-state" role={kind === 'error' && !setup ? 'alert' : undefined}>
    {setup ? <BookOpen size={39} strokeWidth={1.2} aria-hidden="true" /> : <FileWarning size={34} strokeWidth={1.4} aria-hidden="true" />}
    <h1>{setup ? '论文库还没有准备好' : scope === 'catalog' ? '暂时无法打开论文库' : '暂时无法打开这篇论文'}</h1>
    <p>{setup ? '导入 arXiv 论文并生成中文译文，就可以开始对照阅读。' : '检查网络连接或论文数据地址，然后重新试一次。'}</p>
    {setup && <div className="setup-instructions">
      <p>在项目终端中准备第一篇论文：</p>
      <pre><code>{'npm run paper:import -- 1706.03762v7\nnpm run paper:translate -- attention-is-all-you-need'}</code></pre>
      <p>本地数据准备好后，点击重新读取；部署时可连接独立的论文存储。</p>
    </div>}
    {error && !setup && <details className="error-details"><summary>查看错误详情</summary><p>{error.message}</p></details>}
    {onRetry && <button className="primary-button" onClick={onRetry}><RefreshCw size={16} aria-hidden="true" />重新读取</button>}
  </div>
}
