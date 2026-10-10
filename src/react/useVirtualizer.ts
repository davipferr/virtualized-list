import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { DomVirtualizer } from '../dom/dom-virtualizer'
import type { VirtualizerOptions } from '../core/virtualizer'

/**
 * React adapter: all logic lives in the framework-free core + DOM binding.
 * This hook only owns the instance, attaches it to the scroll element,
 * and subscribes to its snapshot.
 *
 * ```tsx
 * const { scrollRef, items, windowTop, scrollHeight, measureElement } = useVirtualizer({ count, estimateSize: 40 })
 * <div ref={scrollRef} style={{ overflow: 'auto', height: 600 }}>
 *   <div style={{ height: scrollHeight, position: 'relative' }}>
 *     <div style={{ position: 'absolute', top: windowTop, width: '100%' }}>
 *       {items.map((it) => (
 *         <div key={it.index} data-index={it.index} ref={measureElement}
 *              style={{ position: 'absolute', top: 0, width: '100%', transform: `translateY(${it.top - windowTop}px)` }} />
 *       ))}
 *     </div>
 *   </div>
 * </div>
 * ```
 */
export function useVirtualizer<T extends HTMLElement = HTMLDivElement>(options: VirtualizerOptions) {
  const [virtualizer] = useState(() => new DomVirtualizer(options))
  const scrollRef = useRef<T>(null)

  // Updates from scroll / ResizeObserver are flushed synchronously, before paint.
  const state = useSyncExternalStore(virtualizer.subscribe, virtualizer.getState, virtualizer.getState)

  useLayoutEffect(() => {
    if (!scrollRef.current) return
    return virtualizer.attach(scrollRef.current)
  }, [virtualizer])

  const { count, estimateSize } = options
  useEffect(() => {
    virtualizer.setCount(count, estimateSize)
  }, [virtualizer, count, estimateSize])

  return {
    virtualizer,
    scrollRef,
    items: state.items,
    windowTop: state.windowTop,
    scrollHeight: state.scrollHeight,
    totalSize: state.totalSize,
    isScaled: state.isScaled,
    measureElement: virtualizer.measureElement,
    scrollToIndex: virtualizer.scrollToIndex,
    scrollToOffset: virtualizer.scrollToOffset,
  }
}
