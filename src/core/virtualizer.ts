import { FenwickTree } from './fenwick'

/**
 * The framework-free engine. Pure math, no DOM:
 *
 *   (scroll position, row sizes, viewport size) -> which rows to render, and where.
 *
 * ## Two coordinate spaces
 *
 * - **virtual**: the "real" layout. Row i starts at prefixSum(i); the list is
 *   `totalSize` px tall (≈40M px for 1M rows).
 * - **dom**: what the browser can actually lay out. The spacer element is
 *   `scrollHeight = min(totalSize, maxScrollHeight)` px tall, because Chrome caps
 *   element heights at ~33.5M px and Firefox at ~17.9M px.
 *
 * When the list fits (`!isScaled`) the two spaces are identical. When it doesn't,
 * `offset` (virtual scrollTop) and `domScrollTop` are kept in a near-proportional
 * relationship (see `setDomScrollTop`). Rows are never scaled: a rendered row is
 * placed at `dom = domScrollTop + (start - offset)`, so everything inside the
 * viewport has exact, unscaled pixel spacing. Only the *scroll position* is scaled.
 */

export type Align = 'start' | 'center' | 'end' | 'auto'

export interface VirtualizerOptions {
  count: number
  /** Estimated row size in px (a number, or per-index). */
  estimateSize: number | ((index: number) => number)
  /** Extra rows rendered above and below the viewport. Default 4. */
  overscan?: number
  /** Largest element height the browser can lay out. Default 15M (safe everywhere). */
  maxScrollHeight?: number
}

export interface VirtualItem {
  index: number
  /** Start in virtual space. */
  start: number
  size: number
  /** Where to place the row inside the scroll content, in DOM px (use translateY). */
  top: number
}

/** Below this many px of error we never touch the DOM's scrollTop. */
const SCROLL_EPSILON = 1
/** In scaled mode, tolerate this relative deviation from the proportional mapping. */
const SCALED_TOLERANCE = 0.1

export const DEFAULT_MAX_SCROLL_HEIGHT = 15_000_000

export class Virtualizer {
  private sizes: FenwickTree
  private measured: Uint8Array
  private overscan: number
  private maxScrollHeight: number

  /** Virtual scroll offset — the source of truth for what is visible. */
  private _offset = 0
  /** Last known DOM scrollTop of the scroll element. */
  private _domScrollTop = 0
  private _viewport = 0
  /** A scrollTop the host should write to the DOM, if any. */
  private pendingScrollTop: number | null = null
  /** Bumped whenever sizes change; lets hosts cheaply detect layout changes. */
  private _layoutVersion = 0

  constructor(options: VirtualizerOptions) {
    this.overscan = options.overscan ?? 4
    this.maxScrollHeight = options.maxScrollHeight ?? DEFAULT_MAX_SCROLL_HEIGHT
    this.measured = new Uint8Array(options.count)
    this.sizes = new FenwickTree(estimates(options.count, options.estimateSize))
  }

  // ---- read-only state ------------------------------------------------------

  get count(): number {
    return this.sizes.length
  }
  /** Full virtual height of the list. */
  get totalSize(): number {
    return this.sizes.total
  }
  /** Height to give the spacer element in the DOM. */
  get scrollHeight(): number {
    return Math.min(this.totalSize, this.maxScrollHeight)
  }
  get isScaled(): boolean {
    return this.totalSize > this.maxScrollHeight
  }
  get offset(): number {
    return this._offset
  }
  get domScrollTop(): number {
    return this._domScrollTop
  }
  get viewportSize(): number {
    return this._viewport
  }
  get layoutVersion(): number {
    return this._layoutVersion
  }
  /** Largest virtual offset. */
  get maxOffset(): number {
    return Math.max(0, this.totalSize - this._viewport)
  }
  /** Largest DOM scrollTop. */
  get maxDomScrollTop(): number {
    return Math.max(0, this.scrollHeight - this._viewport)
  }

  getStart(index: number): number {
    return this.sizes.prefixSum(index)
  }
  getSize(index: number): number {
    return this.sizes.get(index)
  }
  isMeasured(index: number): boolean {
    return this.measured[index] === 1
  }
  /** Index of the row containing virtual pixel `offset`. O(log n). */
  indexAt(offset: number): number {
    return this.sizes.lowerBound(offset)
  }

  /** Proportional virtual -> DOM mapping (exact identity when not scaled). */
  toDom(offset: number): number {
    const V = this.maxOffset
    return V > 0 ? (offset * this.maxDomScrollTop) / V : 0
  }

  // ---- inputs ---------------------------------------------------------------

  setViewportSize(size: number): void {
    if (size === this._viewport) return
    this._viewport = size
    this.reconcile()
  }

  /**
   * Feed a scroll event's scrollTop. Updates the virtual offset.
   *
   * Unscaled: offset === domScrollTop.
   * Scaled:   we interpolate toward the edge we're moving to, so that
   *           dom 0 <-> virtual 0 and dom max <-> virtual max always hold, while
   *           the local ratio stays ≈ totalSize / scrollHeight. This lets scroll
   *           anchoring (below) change `offset` without writing scrollTop, which
   *           would otherwise interrupt momentum scrolling.
   */
  setDomScrollTop(dom: number): void {
    const D = this.maxDomScrollTop
    const V = this.maxOffset
    dom = clamp(dom, 0, D)
    const prev = this._domScrollTop
    if (dom === prev) return
    const offset = clamp(this._offset, 0, V)

    if (!this.isScaled) this._offset = dom
    else if (dom <= 0) this._offset = 0
    else if (dom >= D) this._offset = V
    else if (dom < prev) this._offset = (offset * dom) / prev
    else this._offset = V - ((V - offset) * (D - dom)) / (D - prev)

    this._domScrollTop = dom
    this.pendingScrollTop = null
  }

  /** Tell the engine what scrollTop the DOM actually ended up with after a write. */
  syncDomScrollTop(dom: number): void {
    this._domScrollTop = clamp(dom, 0, this.maxDomScrollTop)
  }

  /**
   * Record a measured size. If the row starts above the viewport, shift the
   * virtual offset by the same delta so visible content doesn't jump (scroll anchoring).
   * Call `reconcile()` (or `takePendingScrollTop()`) after a batch of measurements.
   */
  measure(index: number, size: number): boolean {
    if (index < 0 || index >= this.count) return false
    this.measured[index] = 1
    const start = this.sizes.prefixSum(index)
    // If we're pinned to the end of the list, stay pinned as the list grows/shrinks.
    const atEnd = this._offset > 0 && this._offset >= this.maxOffset - 0.5
    const delta = this.sizes.set(index, size)
    if (delta === 0) return false
    this._layoutVersion++
    if (atEnd) this._offset = this.maxOffset
    else if (start < this._offset) this._offset += delta
    return true
  }

  /** Compute the virtual offset that brings `index` into view. */
  getOffsetForIndex(index: number, align: Align = 'auto'): number {
    index = clamp(index, 0, this.count - 1)
    const start = this.sizes.prefixSum(index)
    const size = this.sizes.get(index)
    const vp = this._viewport
    let target: number
    switch (align) {
      case 'start':
        target = start
        break
      case 'end':
        target = start + size - vp
        break
      case 'center':
        target = start + size / 2 - vp / 2
        break
      default:
        if (start >= this._offset && start + size <= this._offset + vp) return this._offset
        target = start < this._offset ? start : start + size - vp
    }
    return clamp(target, 0, this.maxOffset)
  }

  scrollToIndex(index: number, align: Align = 'auto'): void {
    this.scrollToOffset(this.getOffsetForIndex(index, align))
  }

  /** Jump to a virtual offset. Positions the DOM proportionally. */
  scrollToOffset(offset: number): void {
    this._offset = clamp(offset, 0, this.maxOffset)
    this.pendingScrollTop = this.toDom(this._offset)
  }

  /**
   * After sizes/viewport change, decide whether the DOM scrollTop has to move.
   *
   * - Unscaled: DOM must equal the virtual offset exactly (rows sit at their real
   *   offsets), so any anchoring adjustment becomes a scrollTop write.
   * - Scaled: rows are placed relative to the current scrollTop, so we can absorb
   *   anchoring into `offset` without touching the DOM — unless the mapping has
   *   drifted far from proportional (only happens near the edges).
   */
  reconcile(): void {
    const V = this.maxOffset
    const D = this.maxDomScrollTop
    this._offset = clamp(this._offset, 0, V)
    this._domScrollTop = clamp(this._domScrollTop, 0, D)
    const dom = this._domScrollTop
    if (!this.isScaled) {
      if (Math.abs(this._offset - dom) >= SCROLL_EPSILON / 2) this.pendingScrollTop = this._offset
      return
    }
    const ideal = this.toDom(this._offset)
    const tolerance = Math.max(SCROLL_EPSILON, SCALED_TOLERANCE * Math.min(dom, D - dom))
    if (Math.abs(ideal - dom) > tolerance) this.pendingScrollTop = ideal
  }

  /** Returns (and clears) a scrollTop the host must write to the scroll element. */
  takePendingScrollTop(): number | null {
    this.reconcile()
    const pending = this.pendingScrollTop
    this.pendingScrollTop = null
    return pending
  }

  // ---- output ---------------------------------------------------------------

  /** First/last visible row (inclusive), without overscan. */
  getVisibleRange(): [number, number] {
    if (this.count === 0) return [0, -1]
    const first = this.sizes.lowerBound(this._offset)
    const last = this.sizes.lowerBound(this._offset + Math.max(0, this._viewport - 1))
    return [first, last]
  }

  getVirtualItems(): VirtualItem[] {
    const [first, last] = this.getVisibleRange()
    if (last < first) return []
    const from = Math.max(0, first - this.overscan)
    const to = Math.min(this.count - 1, last + this.overscan)
    const shift = this._domScrollTop - this._offset
    const items: VirtualItem[] = []
    let start = this.sizes.prefixSum(from)
    for (let i = from; i <= to; i++) {
      const size = this.sizes.get(i)
      items.push({ index: i, start, size, top: start + shift })
      start += size
    }
    return items
  }

  /** Resize the list, preserving known sizes for indices that still exist. */
  setCount(count: number, estimateSize: VirtualizerOptions['estimateSize']): void {
    if (count === this.count) return
    const values = estimates(count, estimateSize)
    const measured = new Uint8Array(count)
    for (let i = 0; i < Math.min(count, this.count); i++) {
      if (this.measured[i]) {
        values[i] = this.sizes.get(i)
        measured[i] = 1
      }
    }
    this.sizes = new FenwickTree(values)
    this.measured = measured
    this._layoutVersion++
    this.reconcile()
  }
}

function estimates(count: number, estimate: VirtualizerOptions['estimateSize']): Float64Array {
  const values = new Float64Array(count)
  if (typeof estimate === 'number') values.fill(estimate)
  else for (let i = 0; i < count; i++) values[i] = estimate(i)
  return values
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
