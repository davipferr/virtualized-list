import { DEFAULT_MAX_SCROLL_HEIGHT } from '../core/virtualizer'

let cached: number | undefined

/**
 * Detect the largest height this browser will lay out for an element.
 * Browsers silently clamp oversized heights (Chrome ≈ 33,554,428px, Firefox ≈ 17,895,697px),
 * so we ask for an absurd height and read back what we actually got.
 * We then keep a safety margin, since the cap also bounds child offsets.
 */
export function getMaxElementHeight(): number {
  if (cached !== undefined) return cached
  if (typeof document === 'undefined' || !document.body) return DEFAULT_MAX_SCROLL_HEIGHT
  const probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;top:0;left:0;width:1px;visibility:hidden;height:1000000000px'
  document.body.appendChild(probe)
  const measured = probe.getBoundingClientRect().height
  probe.remove()
  // Garbage (0, or no clamping in some exotic engine) -> fall back to a value safe everywhere.
  const ok = measured > 1_000_000 && measured < 1_000_000_000
  cached = ok ? Math.floor(measured * 0.95) : DEFAULT_MAX_SCROLL_HEIGHT
  return cached
}
