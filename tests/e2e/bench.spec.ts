import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { open, settle } from './helpers'

/**
 * Scroll benchmark: ours vs TanStack Virtual, same rows, same scroll script.
 *
 * Each run drives scrollTop from a requestAnimationFrame loop (so every frame has a scroll
 * to handle), records frame intervals in the page, and captures a Chrome performance trace.
 * Open any bench-results/trace-*.json in the DevTools Performance panel ("Load profile…").
 *
 * Run: npm run bench
 */

const OUT = 'bench-results'
const FRAMES = 240
const FRAME_BUDGET = 1000 / 60

interface Scenario {
  name: string
  startIndex: number
  pxPerFrame: number
}

const scenarios: Scenario[] = [
  { name: 'steady scroll from top (60px/frame)', startIndex: 0, pxPerFrame: 60 },
  { name: 'fast fling mid-list (400px/frame)', startIndex: 500_000, pxPerFrame: 400 },
]
const throttles = [1, 4]
const impls = ['ours', 'tanstack'] as const

interface Result {
  impl: string
  scenario: string
  cpu: string
  fps: number
  p50: number
  p95: number
  p99: number
  dropped: number
  mainThreadMsPerFrame: number
  layoutMsPerFrame: number
  scriptMsPerFrame: number
  trace: string
}

const results: Result[] = []

test.describe.configure({ mode: 'serial' })
test.skip(({ browserName }) => browserName !== 'chromium', 'tracing + CPU throttling need Chromium/CDP')

for (const scenario of scenarios) {
  for (const cpu of throttles) {
    for (const impl of impls) {
      test(`${impl} · ${scenario.name} · ${cpu}x CPU`, async ({ page, browser }) => {
        await open(page, impl)
        await page.evaluate((i) => window.__demo!.scrollToIndex(i, 'start'), scenario.startIndex)
        await settle(page)
        // let the page go quiet before measuring
        await page.waitForTimeout(300)

        const cdp = await page.context().newCDPSession(page)
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })

        mkdirSync(OUT, { recursive: true })
        const trace = `${OUT}/trace-${impl}-${scenario.startIndex ? 'fling' : 'steady'}-${cpu}x.json`
        await browser.startTracing(page, {
          path: trace,
          categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'toplevel', 'blink.user_timing'],
        })
        const frames = await scrollFrames(page, scenario.pxPerFrame)
        await browser.stopTracing()
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })

        const t = summarizeTrace(trace)
        const sorted = [...frames].sort((a, b) => a - b)
        const total = frames.reduce((a, b) => a + b, 0)
        const r: Result = {
          impl,
          scenario: scenario.name,
          cpu: `${cpu}x`,
          fps: (frames.length * 1000) / total,
          p50: pct(sorted, 0.5),
          p95: pct(sorted, 0.95),
          p99: pct(sorted, 0.99),
          dropped: frames.filter((f) => f > FRAME_BUDGET * 1.5).length / frames.length,
          mainThreadMsPerFrame: t.mainThread / frames.length,
          layoutMsPerFrame: t.layout / frames.length,
          scriptMsPerFrame: t.script / frames.length,
          trace,
        }
        results.push(r)
        console.log(
          `${impl.padEnd(8)} ${cpu}x  ${r.fps.toFixed(1)} fps  p95 ${r.p95.toFixed(1)}ms  dropped ${(r.dropped * 100).toFixed(1)}%  main ${r.mainThreadMsPerFrame.toFixed(2)}ms/frame`,
        )

        // The bar we hold ourselves to: 60fps on an unthrottled CPU.
        if (impl === 'ours' && cpu === 1) {
          expect(r.fps).toBeGreaterThan(55)
          expect(r.dropped).toBeLessThan(0.05)
        }
      })
    }
  }
}

test.afterAll(() => {
  if (!results.length) return
  writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2))
  const head =
    '| impl | scenario | CPU | fps | p50 ms | p95 ms | p99 ms | dropped | main thread ms/frame | script ms/frame | layout ms/frame |\n' +
    '|---|---|---|---|---|---|---|---|---|---|---|\n'
  const rows = results
    .map(
      (r) =>
        `| ${r.impl} | ${r.scenario} | ${r.cpu} | ${r.fps.toFixed(1)} | ${r.p50.toFixed(1)} | ${r.p95.toFixed(1)} | ${r.p99.toFixed(1)} | ${(r.dropped * 100).toFixed(1)}% | ${r.mainThreadMsPerFrame.toFixed(2)} | ${r.scriptMsPerFrame.toFixed(2)} | ${r.layoutMsPerFrame.toFixed(2)} |`,
    )
    .join('\n')
  writeFileSync(`${OUT}/RESULTS.md`, head + rows + '\n')
  console.log('\n' + head + rows)
})

/** Scroll by `px` every animation frame for FRAMES frames; return frame intervals (ms). */
async function scrollFrames(page: Page, px: number): Promise<number[]> {
  return page.evaluate(
    ({ px, n }) =>
      new Promise<number[]>((resolve) => {
        const el = window.__demo!.scrollEl
        const intervals: number[] = []
        let last = 0
        performance.mark('bench-start')
        const tick = (now: number) => {
          if (last) intervals.push(now - last)
          last = now
          if (intervals.length >= n) {
            performance.mark('bench-end')
            return resolve(intervals)
          }
          el.scrollTop += px
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    { px, n: FRAMES },
  )
}

interface TraceEvent {
  name: string
  ph: string
  pid: number
  tid: number
  ts: number
  dur?: number
  args?: { name?: string }
}

/**
 * Main-thread time between the bench-start / bench-end marks, by category.
 * Trace events nest (RunTask > FunctionCall > ...), so each category is the *union* of its
 * events' intervals — never a plain sum, which would double-count.
 */
function summarizeTrace(path: string) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const events: TraceEvent[] = Array.isArray(raw) ? raw : raw.traceEvents
  const start = events.find((e) => e.name === 'bench-start')
  const end = events.find((e) => e.name === 'bench-end' && e.pid === start?.pid)
  const main = events.find(
    (e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain' && e.pid === start?.pid,
  )
  if (!start || !end || !main) return { mainThread: NaN, layout: NaN, script: NaN }
  const busy = (names: string[]) => {
    const spans = events
      .filter((e) => e.ph === 'X' && e.pid === main.pid && e.tid === main.tid && names.includes(e.name))
      .map((e) => [Math.max(e.ts, start.ts), Math.min(e.ts + (e.dur ?? 0), end.ts)])
      .filter(([a, b]) => b > a)
      .sort((x, y) => x[0] - y[0])
    let total = 0
    let reached = -Infinity // end of the union so far
    for (const [a, b] of spans) {
      if (b <= reached) continue
      total += b - Math.max(a, reached)
      reached = b
    }
    return total / 1000
  }
  return {
    mainThread: busy(['RunTask', 'ThreadControllerImpl::RunTask']),
    layout: busy(['Layout', 'UpdateLayoutTree']),
    script: busy(['FunctionCall', 'EventDispatch', 'FireAnimationFrame', 'RunMicrotasks', 'TimerFire', 'V8.Execute']),
  }
}

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}
