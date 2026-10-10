import { DEFAULT_MAX_SCROLL_HEIGHT } from '../core/virtualizer'

let cached: number | undefined

/**
 * Detect the largest height this browser will lay out for an element.
 *
 * Browsers disagree on what happens past the limit:
 * - Chrome clamps: `height: 1e9px` lays out at ≈33,554,428px.
 * - Firefox drops the value: anything above ≈17,895,697px lays out as 0.
 *
 * So we binary-search for the largest height that lays out at the size we asked for,
 * which handles both. ~30 layouts of one hidden div; runs once and is cached.
 * We then keep a safety margin, since the cap also bounds child offsets.
 */
export function getMaxElementHeight(): number {
  if (cached !== undefined) return cached
  if (typeof document === 'undefined' || !document.body) return DEFAULT_MAX_SCROLL_HEIGHT
  const probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;top:0;left:0;width:1px;visibility:hidden'
  document.body.appendChild(probe)
  const fits = (h: number) => {
    probe.style.height = `${h}px`
    return probe.getBoundingClientRect().height >= h - 1
  }
  let lo = 1_000_000 // known to fit everywhere
  let hi = 1_000_000_000 // known not to
  if (!fits(lo)) lo = 0
  while (lo > 0 && hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (fits(mid)) lo = mid
    else hi = mid
  }
  probe.remove()
  cached = lo > 0 ? Math.floor(lo * 0.95) : DEFAULT_MAX_SCROLL_HEIGHT
  return cached
}
