import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { getMaxElementHeight } from '../src'
import { OurList } from './OurList'
import { TanstackList } from './TanstackList'
import type { DemoApi } from './types'
import './styles.css'

declare global {
  interface Window {
    __demo?: DemoApi & { setExtra(index: number, px: number): void; maxElementHeight: number }
  }
}

const params = new URLSearchParams(location.search)
const impl = params.get('impl') === 'tanstack' ? 'tanstack' : 'ours'
const count = Number(params.get('count') ?? 1_000_000)
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

function useFps(): number {
  const [fps, setFps] = useState(0)
  useEffect(() => {
    let frames = 0
    let last = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      frames++
      if (now - last >= 500) {
        setFps((frames * 1000) / (now - last))
        frames = 0
        last = now
      }
      raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [])
  return fps
}

function App() {
  const [extras, setExtras] = useState<ReadonlyMap<number, number>>(new Map())
  const [api, setApi] = useState<DemoApi | null>(null)
  const [, force] = useState(0)
  const [status, setStatus] = useState('')
  const [highlight, setHighlight] = useState<number | null>(null)
  const jumpRef = useRef<HTMLInputElement>(null)
  const fps = useFps()

  const onApi = useCallback((a: DemoApi) => {
    window.__demo = {
      ...a,
      maxElementHeight: getMaxElementHeight(),
      setExtra: (index, px) => setExtras((m) => new Map(m).set(index, px)),
    }
    setApi((prev) => (prev?.scrollEl === a.scrollEl ? prev : a))
  }, [])

  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [])

  const stats = api?.stats()
  const List = impl === 'tanstack' ? TanstackList : OurList
  const PLACE = { start: 'at the top', center: 'in the middle', end: 'at the bottom' } as const

  const jump = (align: 'start' | 'center' | 'end', target?: number) => {
    if (!api) return
    const typed = Math.trunc(Number(jumpRef.current?.value) || 0)
    const index = Math.min(count - 1, Math.max(0, target ?? typed))
    api.scrollToIndex(index, align)
    setHighlight(index)
    if (target !== undefined) return setStatus(`Showing the ${index === 0 ? 'first' : 'last'} row, #${fmt(index)}.`)
    // scrollToIndex writes scrollTop synchronously, so we can check for clamping right away.
    const el = api.scrollEl
    const atEnd = el.scrollTop >= el.scrollHeight - el.clientHeight - 1
    const atTop = el.scrollTop <= 0
    const clamped = (atEnd && align !== 'end') || (atTop && align !== 'start')
    setStatus(
      clamped
        ? `Row #${fmt(index)} is too close to the ${atEnd ? 'end' : 'start'} of the list to be shown ${PLACE[align]}, so the list stopped at its ${atEnd ? 'last' : 'first'} row.`
        : `Row #${fmt(index)} shown ${PLACE[align]}.`,
    )
  }

  const growRowAbove = () => {
    if (!api) return
    const vpTop = api.scrollEl.getBoundingClientRect().top
    const firstVisible = [...document.querySelectorAll<HTMLElement>('.row')]
      .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
      .find((r) => r.getBoundingClientRect().bottom > vpTop + 1)
    const i = Number(firstVisible?.dataset.index ?? 0) - 1
    if (i < 0) return setStatus('Nothing above the first row to grow. Scroll down first.')
    setExtras((m) => new Map(m).set(i, (m.get(i) ?? 0) + 120))
    setHighlight(i)
    setStatus(
      `Grew row #${fmt(i)} (just above the view) by 120px. The rows you see didn't move: that's scroll anchoring. Scroll up to see it.`,
    )
  }

  return (
    <div className="app">
      <header>
        <h1>{fmt(count)} rows</h1>
        <a className={impl === 'ours' ? 'active' : ''} href={`?impl=ours&count=${count}`}>ours</a>
        <a className={impl === 'tanstack' ? 'active' : ''} href={`?impl=tanstack&count=${count}`}>TanStack Virtual</a>
        <span className="fps" data-testid="fps">{fps.toFixed(0)} fps</span>
      </header>
      {stats && (
        <div className="stats">
          <span>virtual height {fmt(stats.totalSize)}px</span>
          <span>DOM height {fmt(stats.scrollHeight)}px</span>
          <span>browser cap ≈ {fmt(getMaxElementHeight() / 0.95)}px</span>
          <span>{stats.isScaled ? `scaled ×${(stats.totalSize / stats.scrollHeight).toFixed(3)}` : 'unscaled'}</span>
          <span>{stats.rendered} rows in DOM</span>
        </div>
      )}
      <div className="controls">
        <button onClick={() => jump('start', 0)}>first row</button>
        <button onClick={() => jump('end', count - 1)}>last row</button>
        <label className="goto">
          row
          <input ref={jumpRef} type="number" defaultValue={Math.floor(count / 2)} min={0} max={count - 1} />
        </label>
        <button onClick={() => jump('start')}>show at top</button>
        <button onClick={() => jump('center')}>show in middle</button>
        <button onClick={() => jump('end')}>show at bottom</button>
        <button title="Grow a row just above the viewport: content must not move" onClick={growRowAbove}>
          grow row above
        </button>
      </div>
      <div className="status" role="status">
        {status}
      </div>
      {highlight !== null && <style>{`.row[data-index="${highlight}"] { background: #e0f2fe; }`}</style>}
      <List count={count} extras={extras} onApi={onApi} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
