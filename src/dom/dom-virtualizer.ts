import { Virtualizer, type Align, type VirtualItem, type VirtualizerOptions } from '../core/virtualizer'
import { getMaxElementHeight } from './max-height'

export interface VirtualState {
  items: VirtualItem[]
  /**
   * DOM offset of the first rendered row. Position a wrapper at `top: windowTop` and the rows
   * inside it at `translateY(item.top - windowTop)`. Near the cap, offsets reach ~33M px, where
   * a float32 transform only has 2–4px precision; layout `top` keeps 1/64px precision.
   */
  windowTop: number
  /** Height for the spacer element (capped under the browser limit). */
  scrollHeight: number
  /** Real virtual height of the list. */
  totalSize: number
  isScaled: boolean
}

/**
 * Framework-free DOM glue around the pure engine:
 * - listens to `scroll` on the scroll element,
 * - measures rows with one shared ResizeObserver (`measureElement`),
 * - writes scrollTop back when the engine asks for it (anchoring, scrollToIndex),
 * - exposes an immutable snapshot + subscribe(), which is all a UI framework needs.
 */
export class DomVirtualizer {
  readonly core: Virtualizer
  private el: HTMLElement | null = null
  private ro: ResizeObserver | null = null
  private nodes = new Map<number, Element>()
  private listeners = new Set<() => void>()
  private state: VirtualState
  private stateKey = ''

  constructor(options: VirtualizerOptions) {
    this.core = new Virtualizer({ ...options, maxScrollHeight: options.maxScrollHeight ?? getMaxElementHeight() })
    if (typeof ResizeObserver !== 'undefined') this.ro = new ResizeObserver(this.onResize)
    this.state = this.computeState()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = (): VirtualState => this.state

  /** Attach to the scroll element. Returns a detach function. */
  attach(el: HTMLElement): () => void {
    this.el = el
    el.style.overflowAnchor = 'none' // we do anchoring ourselves
    el.addEventListener('scroll', this.onScroll, { passive: true })
    this.ro?.observe(el)
    this.core.setViewportSize(el.clientHeight)
    this.core.syncDomScrollTop(el.scrollTop)
    this.flush()
    return () => {
      el.removeEventListener('scroll', this.onScroll)
      this.ro?.unobserve(el)
      if (this.el === el) this.el = null
    }
  }

  /** Ref callback for rows. Rows must carry `data-index`. */
  measureElement = (node: Element | null): void => {
    if (!node || !this.ro) return
    const index = Number(node.getAttribute('data-index'))
    const prev = this.nodes.get(index)
    if (prev === node) return
    if (prev) this.ro.unobserve(prev)
    this.nodes.set(index, node)
    this.ro.observe(node, { box: 'border-box' })
  }

  scrollToIndex = (index: number, align: Align = 'start'): void => {
    this.core.scrollToIndex(index, align)
    this.flush()
  }

  scrollToOffset = (offset: number): void => {
    this.core.scrollToOffset(offset)
    this.flush()
  }

  setCount(count: number, estimateSize: VirtualizerOptions['estimateSize']): void {
    this.core.setCount(count, estimateSize)
    this.flush()
  }

  private onScroll = (): void => {
    if (!this.el) return
    this.core.setDomScrollTop(this.el.scrollTop)
    this.flush()
  }

  private onResize = (entries: ResizeObserverEntry[]): void => {
    for (const entry of entries) {
      const target = entry.target
      if (target === this.el) {
        this.core.setViewportSize(this.el.clientHeight)
        continue
      }
      const index = Number(target.getAttribute('data-index'))
      if (!target.isConnected) {
        // Row was unmounted: stop observing; a size of 0 here is not a real measurement.
        this.ro!.unobserve(target)
        if (this.nodes.get(index) === target) this.nodes.delete(index)
        continue
      }
      const size = entry.borderBoxSize?.[0]?.blockSize ?? target.getBoundingClientRect().height
      this.core.measure(index, size)
    }
    this.flush()
  }

  /** Apply any scrollTop the engine wants, then publish a new snapshot if anything changed. */
  private flush(): void {
    const pending = this.core.takePendingScrollTop()
    if (pending !== null && this.el) {
      this.el.scrollTop = pending
      // Browsers round scrollTop; record what we really got so the next scroll event
      // is recognized as ours and doesn't move the virtual offset.
      this.core.syncDomScrollTop(this.el.scrollTop)
    }
    const items = this.core.getVirtualItems()
    const first = items[0]
    const key = `${first?.index}:${items.length}:${first?.top}:${this.core.layoutVersion}:${this.core.scrollHeight}`
    if (key === this.stateKey) return
    this.stateKey = key
    this.state = {
      items,
      windowTop: first?.top ?? 0,
      scrollHeight: this.core.scrollHeight,
      totalSize: this.core.totalSize,
      isScaled: this.core.isScaled,
    }
    for (const listener of this.listeners) listener()
  }

  private computeState(): VirtualState {
    const items = this.core.getVirtualItems()
    return {
      items,
      windowTop: items[0]?.top ?? 0,
      scrollHeight: this.core.scrollHeight,
      totalSize: this.core.totalSize,
      isScaled: this.core.isScaled,
    }
  }
}
