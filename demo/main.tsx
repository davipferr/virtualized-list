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
  const jump = (align: 'start' | 'center' | 'end') => api?.scrollToIndex(Number(jumpRef.current?.value ?? 0), align)

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
        <input ref={jumpRef} type="number" defaultValue={count - 1} min={0} max={count - 1} aria-label="row index" />
        <button onClick={() => jump('start')}>jump (start)</button>
        <button onClick={() => jump('center')}>jump (center)</button>
        <button onClick={() => jump('end')}>jump (end)</button>
        <button
          title="Grow a row just above the viewport: content must not move"
          onClick={() => {
            const top = [...document.querySelectorAll<HTMLElement>('.row')].find(
              (r) => r.getBoundingClientRect().bottom > api!.scrollEl.getBoundingClientRect().top,
            )
            const i = Number(top?.dataset.index ?? 1) - 1
            if (i >= 0) setExtras((m) => new Map(m).set(i, (m.get(i) ?? 0) + 120))
          }}
        >
          grow row above
        </button>
      </div>
      <List count={count} extras={extras} onApi={onApi} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
