import { memo, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { SplitView, type SplitViewApi } from '../registry/split-view/split-view'

const isMac = /mac|iphone|ipad/i.test(
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform,
)
const MOD = isMac ? '⌘' : 'Ctrl'

/* ------------------------------------------------------------------ */
/* Static content (memoised: never re-renders during a drag)           */
/* ------------------------------------------------------------------ */

const FILES = ['app.tsx', 'router.ts', 'provider.ts', 'models.json', 'split-view.tsx', 'split-view-physics.ts', 'README.md']

const Sidebar = memo(function Sidebar() {
  return (
    <>
      <div className="section">Explorer</div>
      {FILES.map((f, i) => (
        <div key={f} className={'file' + (i === 4 ? ' active' : '')}>
          <span className="dot" />
          {f}
        </div>
      ))}
      <div className="section">Behaviour</div>
      <dl className="facts">
        <dt>Snap</dt><dd>25 · 50 · 75%</dd>
        <dt>Magnet</dt><dd>30px, soft</dd>
        <dt>Settle</dt><dd>spring, 12% bounce</dd>
        <dt>Reset</dt><dd>double-click</dd>
        <dt>Toggle</dt><dd><kbd>{MOD}</kbd><kbd>B</kbd></dd>
      </dl>
    </>
  )
})

const CODE = `import { SplitView } from '@/components/ui/split-view'

export function Workspace() {
  return (
    <SplitView
      persistKey="workspace"
      defaultSizes={['50%']}
      minSizes={['15%']}
      maxSizes={['85%']}
      snapPoints={[0.25, 0.5, 0.75]}
    >
      <Editor />
      <Preview />   {/* double-click divider → 50% */}
    </SplitView>
  )
}`

const Editor = memo(function Editor() {
  return (
    <>
      <div className="pane-head">
        <span className="tab active">Workspace.tsx</span>
        <span className="tab">split-view.tsx</span>
      </div>
      <pre className="code">
        {CODE.split('\n').map((l, i) => (
          <div key={i} className="ln"><span className="no">{i + 1}</span>{l || ' '}</div>
        ))}
      </pre>
    </>
  )
})

const HUES = [228, 262, 196, 330, 160, 24]
const CARDS = Array.from({ length: 480 }, (_, i) => i)

const Preview = memo(function Preview() {
  return (
    <>
      <div className="pane-head">
        <span className="tab active">Preview</span>
        <span className="muted">{CARDS.length} items</span>
      </div>
      <div className="cards">
        {CARDS.map((i) => (
          <div key={i} className="card">
            <div className="thumb" style={{ '--h': HUES[i % HUES.length] } as React.CSSProperties} />
            <div className="card-title">Generation #{1000 + i}</div>
            <div className="card-meta">{['image', 'video', 'audio', 'text'][i % 4]} · {(i * 37) % 60 + 2}s ago</div>
          </div>
        ))}
      </div>
    </>
  )
})

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export default function App() {
  const outer = useRef<SplitViewApi>(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    setCollapsed(!!outer.current?.getCollapsed()[0])
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        outer.current?.toggle(0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <header className="titlebar">
        {isMac && <div className="traffic"><i /><i /><i /></div>}
        <button className="ghost" onClick={() => outer.current?.toggle(0)} title={`Toggle sidebar (${MOD}+B)`} aria-pressed={!collapsed}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1.5" y="2.5" width="13" height="11" rx="2.5" stroke="currentColor" />
            <motion.rect initial={false} animate={{ scaleX: collapsed ? 0 : 1, opacity: collapsed ? 0 : 1 }} transition={{ type: 'spring', visualDuration: 0.3, bounce: 0 }} style={{ originX: 0 }} x="3.5" y="4.5" width="3.5" height="7" rx="1" fill="currentColor" />
          </svg>
        </button>
        <span className="crumbs">ui-registry <b>/</b> split-view</span>
        <span className="hint">
          Drag divider · Double-click to reset · <kbd>{MOD}</kbd><kbd>B</kbd> sidebar · <kbd>←</kbd><kbd>→</kbd> when focused · <kbd>Esc</kbd> cancels
        </span>
      </header>

      {/* Outer: px-sized collapsible sidebar, no snapping */}
      <SplitView
        apiRef={outer}
        persistKey="demo-sidebar"
        className="root"
        defaultSizes={[256]}
        minSizes={[200]}
        maxSizes={[400]}
        overshoot={14}
        collapsible
        snapPoints={[]}
        onCollapsedChange={(c) => setCollapsed(c[0])}
        handleLabels={['Resize sidebar']}
        panelClassNames={['sidebar', 'main']}
      >
        <Sidebar />
        {/* Inner: percentage split with magnetic snap points */}
        <SplitView
          persistKey="demo-split"
          className="fill"
          defaultSizes={['50%']}
          minSizes={['15%']}
          maxSizes={['85%']}
          snapPoints={[0.25, 0.5, 0.75]}
          handleLabels={['Resize editor and preview']}
          panelClassNames={['pane editor', 'pane preview overflow-auto']}
        >
          <Editor />
          <Preview />
        </SplitView>
      </SplitView>
    </div>
  )
}
