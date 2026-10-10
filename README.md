# Virtualized list — 1,000,000 variable-height rows

A framework-free TypeScript virtualization engine, a ~50-line React hook around it, a Vite demo,
and a Playwright suite that proves correctness at 1M rows and benchmarks against TanStack Virtual.

```
src/
  core/fenwick.ts         Fenwick tree (binary indexed tree) of row sizes — pure
  core/virtualizer.ts     the engine: scroll position + sizes -> rows to render — pure, no DOM
  dom/dom-virtualizer.ts  framework-free DOM glue: scroll listener, ResizeObserver, scrollTop writes
  dom/max-height.ts       detects the browser's max element height
  react/useVirtualizer.ts the React adapter (useSyncExternalStore + one layout effect)
demo/                     Vite + React demo, ?impl=ours | ?impl=tanstack
tests/unit/               Vitest: Fenwick tree + engine math
tests/e2e/                Playwright: 1M-row correctness, anchoring, benchmark
```

```bash
npm install
npx playwright install chromium firefox
npm run dev          # http://localhost:5173/?impl=ours  (or ?impl=tanstack, &count=…)
npm test             # unit tests (Vitest)
npm run test:e2e     # Playwright (Chromium) against the production build
npm run test:e2e:firefox  # same suite in Firefox
npm run test:e2e:all #  runs both Chromium and Firefox
npm run bench        # benchmark vs TanStack Virtual -> bench-results/
```

### Troubleshooting

**`npx playwright install` fails with `SELF_SIGNED_CERT_IN_CHAIN`.** Something between you and the
download server (antivirus HTTPS scanning, a corporate proxy) is re-signing HTTPS traffic with its
own certificate. That certificate is trusted by Windows but not by Node, which only uses its bundled
CA list. Tell Node to also trust the operating system's certificate store:

```powershell
# PowerShell, current terminal only
$env:NODE_USE_SYSTEM_CA=1; npx playwright install chromium
```

```bash
# bash / macOS / Linux
NODE_USE_SYSTEM_CA=1 npx playwright install chromium
```

To make it permanent on Windows, run `setx NODE_USE_SYSTEM_CA 1` and open a new terminal.
`NODE_USE_SYSTEM_CA` needs Node ≥ 22.15 / 23.8. Avoid `NODE_TLS_REJECT_UNAUTHORIZED=0`: it turns
off certificate checks entirely instead of trusting your system's certificates.

**Firefox fails with `spawn UNKNOWN`, or Windows says "side-by-side configuration is incorrect"
(`mozglue`).** Windows can't load Playwright's Firefox build on this machine. This is usually a
broken Microsoft Visual C++ Redistributable: reinstall the x64 one and reboot. Chromium tests
(`npm run test:e2e`) don't need Firefox.

## Design

### 1. The engine is just math

`Virtualizer` (in `src/core`) never touches the DOM. Its inputs are `setViewportSize`,
`setDomScrollTop` and `measure(index, size)`. Its outputs are `getVirtualItems()` and an optional
"please set scrollTop to X" (`takePendingScrollTop`). All the browser glue is in `DomVirtualizer`,
which is still framework-free. The React hook only owns the instance and subscribes to its
snapshot with `useSyncExternalStore`, so a Vue, Svelte or Solid adapter would be just as small.

### 2. Variable heights → Fenwick tree

Rows start at an estimate (40px). `ResizeObserver` reports each rendered row's real
`borderBoxSize`, and the size goes into a Fenwick tree:

| operation             | Fenwick                   | prefix-sum array |
| --------------------- | ------------------------- | ---------------- |
| update one row's size | O(log n)                  | O(n)             |
| offset of row i       | O(log n)                  | O(1)             |
| first row at pixel y  | O(log n) (binary lifting) | O(log n)         |

At 1M rows, every measurement into a prefix-sum array rewrites up to 1M entries. That cost shows up
directly in the TanStack trace below: its time goes to rebuilding measurements, not to rendering.

### 3. The browser height limit

1M rows × ~40px = 40M px. Chrome lays out at most 33,554,431px (2³¹ / 64, the LayoutUnit limit)
and Firefox ~17.9M px. Past that, the spacer height is silently clamped and the tail of the list
can't be reached. The e2e suite shows this with TanStack: dragging its scrollbar to the bottom
reaches row #838,847, not #999,999.

The fix uses two coordinate spaces:

- **virtual**: the real layout, `totalSize` px tall.
- **dom**: a spacer `min(totalSize, cap)` px tall. The cap is detected at runtime by
  binary-searching for the largest height that lays out at the requested size, minus a 5% margin.
  A single "ask for 1e9px" probe isn't enough: Chrome clamps oversized heights, but Firefox drops
  them and lays the element out at 0px.

Only the **scroll position** is scaled. Rows are never scaled: a row is placed at
`domScrollTop + (start − offset)`, so everything on screen keeps exact pixel spacing.

Two details that tutorials miss:

- **Edge-converging mapping.** A purely proportional `offset = scrollTop × ratio` would turn every
  size change into a scrollTop write, and writing scrollTop mid-scroll kills momentum scrolling.
  Instead, each scroll step interpolates toward the edge it is moving to:
  `offset' = offset × dom'/dom` going up, and the mirror formula going down. Locally this is about
  1:1 with the global ratio, scrollTop 0 always maps to row 0, and the maximum scrollTop always maps
  to the last row. Anchoring can then adjust `offset` without touching the DOM.
- **Float32 precision.** At 33M px, a `translateY` has only 2–4px of precision, so rows near the
  end overlapped by a pixel (a Playwright test caught this). Rows now sit in one wrapper placed with
  layout `top: windowTop`, which has 1/64px precision across the whole range. Each row then uses a
  small `translateY` relative to that wrapper.

### 4. Scroll anchoring

When a row that starts above the viewport changes size by Δ, the engine shifts `offset` by Δ, so
the visible content stays put:

- **Unscaled:** this becomes a `scrollTop += Δ` write. The written value is read back, because
  browsers round it, so the scroll event that follows is recognised as ours.
- **Scaled:** it is absorbed into the virtual offset with no DOM write, unless the mapping has
  drifted more than 10% from proportional (which only happens near the edges).
- **Pinned to the end:** the list stays pinned to the end as rows below get measured.

Native CSS anchoring is turned off (`overflow-anchor: none`), since this replaces it.

## Tests

**Unit tests (Vitest, 16 tests):** the Fenwick tree is checked against a naive prefix sum under
random updates, plus a 1M-row timing check. The engine tests cover range computation, the capped
height, both edges of the mapping, unscaled row spacing in scaled mode, `scrollToIndex`, and
anchoring in both modes.

**e2e (Playwright, 1M rows, production build):**

- The DOM height stays under the detected cap, and the browser really lays it out at that height.
- Scrollbar at the end shows row #999,999 flush with the bottom. Scrollbar in the middle shows a
  row near 500k.
- `scrollToIndex` lands exactly at the top for rows 123,456, 999,000, 1 and 654,321.
- Wheel scrolling deep in the list keeps the visible rows contiguous: no gaps, overlaps or skipped
  indices.
- **Anchoring:** growing a row above the viewport by 300px moves visible content by under 1px.
  Scrolling up through unmeasured rows (estimated 40px, real 41–200px) moves the content by the
  scroll distance at every step, with no jumps.
- **Reference:** TanStack Virtual can't reach the last row (it stops at #838,847 in Chromium).

## Benchmark vs TanStack Virtual

`npm run bench`. Both implementations render the same `Row` component, 1M rows, overscan 4, in a
production build in headless Chromium. scrollTop is advanced by a fixed amount on every
`requestAnimationFrame` for 240 frames, while a Chrome performance trace is recorded. The CPU is
throttled through CDP to simulate slower machines. Main-thread time is the union of trace-event
intervals, so nested events aren't double-counted.

| impl     | scenario                            | CPU | fps      | p95 frame | dropped | main thread / frame | script / frame |
| -------- | ----------------------------------- | --- | -------- | --------- | ------- | ------------------- | -------------- |
| **ours** | steady scroll from top (60px/frame) | 1x  | **60.0** | 16.7ms    | 0%      | **2.25ms**          | 1.34ms         |
| tanstack | steady scroll from top (60px/frame) | 1x  | 60.0     | 16.7ms    | 0%      | 10.64ms             | 10.12ms        |
| **ours** | steady scroll from top (60px/frame) | 4x  | **60.0** | 16.7ms    | 0%      | **7.60ms**          | 4.62ms         |
| tanstack | steady scroll from top (60px/frame) | 4x  | 15.9     | 100ms     | 85%     | 62.89ms             | 60.09ms        |
| **ours** | fast fling mid-list (400px/frame)   | 1x  | **60.0** | 16.8ms    | 0%      | **2.77ms**          | 1.84ms         |
| tanstack | fast fling mid-list (400px/frame)   | 1x  | 60.0     | 16.8ms    | 0%      | 8.60ms              | 7.96ms         |
| **ours** | fast fling mid-list (400px/frame)   | 4x  | **60.0** | 16.7ms    | 0%      | **9.94ms**          | 6.52ms         |
| tanstack | fast fling mid-list (400px/frame)   | 4x  | 21.6     | 50.1ms    | 98%     | 46.29ms             | 43.49ms        |

Ours holds 60fps with headroom even on a 4×-throttled CPU (≤10ms of a 16.7ms budget). TanStack's
script time is dominated by recomputing measurements across 1M items whenever a row is measured,
the O(n) prefix-sum cost. The bench asserts ≥55fps and <5% dropped frames for ours at 1× CPU.

Each run writes a trace to `bench-results/trace-<impl>-<scenario>-<cpu>.json`. Load it in Chrome
DevTools → Performance → _Load profile…_ to inspect frames, or record your own session there on
`npm run dev`.

Results are from one machine (Windows 11, headless Chromium) and will vary on yours. Re-run
`npm run bench` to get your own numbers.
