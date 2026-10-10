import { memo, type CSSProperties, type Ref } from 'react'
import { rowText } from './data'

interface RowProps {
  index: number
  top: number
  extra: number
  ref?: Ref<HTMLDivElement>
}

/** Same row for both implementations, so the benchmark compares only the virtualizers. */
export const Row = memo(function Row({ index, top, extra, ref }: RowProps) {
  const style: CSSProperties = { transform: `translateY(${top}px)` }
  return (
    <div className="row" data-index={index} ref={ref} style={style}>
      <span className="idx">#{index.toLocaleString('en-US')}</span>
      <span className="txt">{rowText(index)}</span>
      {extra > 0 && <div className="extra" style={{ height: extra }} />}
    </div>
  )
})
