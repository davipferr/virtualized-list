import { useEffect } from 'react'
import { useVirtualizer } from '../src'
import { ESTIMATE } from './data'
import { Row } from './Row'
import type { ListProps } from './types'

export function OurList({ count, extras, onApi }: ListProps) {
  const { scrollRef, items, windowTop, scrollHeight, totalSize, isScaled, measureElement, scrollToIndex } = useVirtualizer({
    count,
    estimateSize: ESTIMATE,
    overscan: 4,
  })

  useEffect(() => {
    onApi({
      impl: 'ours',
      scrollEl: scrollRef.current!,
      scrollToIndex: (i, align = 'start') => scrollToIndex(i, align),
      stats: () => {
        const s = scrollRef.current!
        return { totalSize, scrollHeight, isScaled, rendered: s.querySelectorAll('.row').length }
      },
    })
  })

  return (
    <div ref={scrollRef} className="viewport" data-testid="viewport">
      <div className="spacer" style={{ height: scrollHeight }}>
        <div className="window" style={{ top: windowTop }}>
          {items.map((it) => (
            <Row
              key={it.index}
              index={it.index}
              top={it.top - windowTop}
              extra={extras.get(it.index) ?? 0}
              ref={measureElement}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
