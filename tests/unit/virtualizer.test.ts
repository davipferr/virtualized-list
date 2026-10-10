import { describe, expect, it } from 'vitest'
import { Virtualizer } from '../../src/core/virtualizer'

const VP = 600

function make(count: number, maxScrollHeight = 33_000_000, estimate = 40) {
  const v = new Virtualizer({ count, estimateSize: estimate, overscan: 0, maxScrollHeight })
  v.setViewportSize(VP)
  v.takePendingScrollTop()
  return v
}

describe('Virtualizer: range', () => {
  it('renders only what is visible', () => {
    const v = make(1000)
    expect(v.getVisibleRange()).toEqual([0, 14])
    v.setDomScrollTop(4000)
    expect(v.getVisibleRange()).toEqual([100, 114])
    const items = v.getVirtualItems()
    expect(items[0]).toMatchObject({ index: 100, start: 4000, top: 4000 })
  })

  it('empty list', () => {
    const v = make(0)
    expect(v.getVirtualItems()).toEqual([])
  })
})

describe('Virtualizer: browser height cap', () => {
  const v = () => make(1_000_000, 10_000_000) // 40M virtual, 10M DOM

  it('caps the DOM height', () => {
    const x = v()
    expect(x.totalSize).toBe(40_000_000)
    expect(x.scrollHeight).toBe(10_000_000)
    expect(x.isScaled).toBe(true)
  })

  it('maps the end of the DOM scrollbar to the last row', () => {
    const x = v()
    x.setDomScrollTop(x.maxDomScrollTop)
    expect(x.offset).toBe(x.maxOffset)
    const items = x.getVirtualItems()
    const last = items[items.length - 1]
    expect(last.index).toBe(999_999)
    // last row's bottom sits exactly at the bottom of the spacer
    expect(last.top + last.size).toBeCloseTo(x.scrollHeight, 6)
  })

  it('maps the middle proportionally and back to the top', () => {
    const x = v()
    x.setDomScrollTop(x.maxDomScrollTop / 2)
    expect(x.offset).toBeCloseTo(x.maxOffset / 2, 3)
    x.setDomScrollTop(0)
    expect(x.offset).toBe(0)
  })

  it('places visible rows with real (unscaled) spacing', () => {
    const x = v()
    x.setDomScrollTop(1_234_567)
    const items = x.getVirtualItems()
    for (let k = 1; k < items.length; k++) expect(items[k].top - items[k - 1].top).toBe(40)
    // the row containing the virtual offset is at the DOM scrollTop
    const first = items[0]
    expect(first.top).toBeLessThanOrEqual(x.domScrollTop)
    expect(first.top + first.size).toBeGreaterThan(x.domScrollTop)
  })

  it('scrollToIndex lands the row at the top of the viewport', () => {
    const x = v()
    x.scrollToIndex(777_777, 'start')
    const dom = x.takePendingScrollTop()!
    x.syncDomScrollTop(dom)
    const item = x.getVirtualItems().find((i) => i.index === 777_777)!
    expect(item.top).toBeCloseTo(dom, 6)
  })
})

describe('Virtualizer: scroll anchoring', () => {
  it('unscaled: growth above the viewport shifts scrollTop by the same delta', () => {
    const v = make(1000)
    v.setDomScrollTop(4000) // row 100 at top
    const before = v.getVirtualItems()[0]
    v.measure(50, 140) // +100 above
    const pending = v.takePendingScrollTop()
    expect(pending).toBe(4100)
    v.syncDomScrollTop(pending!)
    const after = v.getVirtualItems()[0]
    expect(after.index).toBe(before.index)
    expect(after.top - v.domScrollTop).toBe(before.top - 4000)
  })

  it('unscaled: growth below the viewport changes nothing', () => {
    const v = make(1000)
    v.setDomScrollTop(4000)
    v.measure(500, 400)
    expect(v.takePendingScrollTop()).toBeNull()
    expect(v.offset).toBe(4000)
  })

  it('scaled: anchoring is absorbed without a scrollTop write mid-list', () => {
    const v = make(1_000_000, 10_000_000)
    v.scrollToIndex(500_000, 'start')
    v.syncDomScrollTop(v.takePendingScrollTop()!)
    const viewTop = (x: Virtualizer) => x.getVirtualItems().find((i) => i.index === 500_000)!.top - x.domScrollTop
    const before = viewTop(v)
    for (let i = 499_990; i < 500_000; i++) v.measure(i, 77) // all above the anchor
    expect(v.takePendingScrollTop()).toBeNull()
    expect(viewTop(v)).toBeCloseTo(before, 6)
  })

  it('scaled: rows below changing size do not move visible content', () => {
    const v = make(1_000_000, 10_000_000)
    v.setDomScrollTop(5_000_000)
    const top = v.getVirtualItems()[0]
    for (let i = top.index + 50; i < top.index + 5000; i++) v.measure(i, 100)
    expect(v.takePendingScrollTop()).toBeNull()
    const again = v.getVirtualItems()[0]
    expect(again.index).toBe(top.index)
    expect(again.top).toBe(top.top)
  })

  it('scaled: interpolation still reaches both edges after anchoring drift', () => {
    const v = make(1_000_000, 10_000_000)
    v.setDomScrollTop(5_000_000)
    for (let i = 0; i < 1000; i++) v.measure(100_000 + i, 300) // big growth above
    v.takePendingScrollTop()
    v.setDomScrollTop(2_000_000)
    v.setDomScrollTop(0)
    expect(v.offset).toBe(0)
    v.setDomScrollTop(v.maxDomScrollTop)
    expect(v.offset).toBe(v.maxOffset)
  })
})
