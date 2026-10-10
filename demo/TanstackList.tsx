import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ESTIMATE } from './data'
import { Row } from './Row'
import type { ListProps } from './types'

/** Reference implementation: TanStack Virtual with dynamic measurement, same rows. */
export function TanstackList({ count, extras, onApi }: ListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATE,
    overscan: 4,
  })
  const total = v.getTotalSize()

  useEffect(() => {
    onApi({
      impl: 'tanstack',
      scrollEl: scrollRef.current!,
      scrollToIndex: (i, align = 'start') => v.scrollToIndex(i, { align }),
      stats: () => {
        const s = scrollRef.current!
        return { totalSize: total, scrollHeight: s.scrollHeight, isScaled: false, rendered: s.querySelectorAll('.row').length }
      },
    })
  })

  return (
    <div ref={scrollRef} className="viewport" data-testid="viewport">
      <div className="spacer" style={{ height: total }}>
        {v.getVirtualItems().map((it) => (
          <Row key={it.index} index={it.index} top={it.start} extra={extras.get(it.index) ?? 0} ref={v.measureElement} />
        ))}
      </div>
    </div>
  )
}
