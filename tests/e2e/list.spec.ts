import { expect, test } from '@playwright/test'
import { expectContiguous, open, settle, visibleRows } from './helpers'

test.describe('1M rows: browser height cap', () => {
  test('DOM height stays under the browser cap while virtual height exceeds it', async ({ page, browserName }) => {
    await open(page)
    const s = await page.evaluate(() => ({ ...window.__demo!.stats(), cap: window.__demo!.maxElementHeight }))
    console.log(`[${browserName}] detected cap ≈ ${Math.round(s.cap / 0.95)}px, virtual height ${Math.round(s.totalSize)}px`)
    expect(s.totalSize).toBeGreaterThan(s.cap / 0.95)
    expect(s.isScaled).toBe(true)
    expect(s.scrollHeight).toBeLessThanOrEqual(s.cap)
    // the browser really laid the spacer out at that height
    const real = await page.evaluate(() => window.__demo!.scrollEl.scrollHeight)
    expect(Math.abs(real - s.scrollHeight)).toBeLessThan(2)
  })

  test('dragging the scrollbar to the very end shows the last row, flush with the bottom', async ({ page }) => {
    await open(page)
    await page.evaluate(() => {
      const el = window.__demo!.scrollEl
      el.scrollTop = el.scrollHeight
    })
    await settle(page)
    const rows = await expectContiguous(page)
    const last = rows[rows.length - 1]
    expect(last.index).toBe(999_999)
    expect(Math.abs(last.bottom - last.vpHeight)).toBeLessThan(1.5)
    await expect(page.getByText('#999,999', { exact: true })).toBeVisible()
  })

  test('the middle of the scrollbar maps to the middle of the list', async ({ page }) => {
    await open(page)
    await page.evaluate(() => {
      const el = window.__demo!.scrollEl
      el.scrollTop = (el.scrollHeight - el.clientHeight) / 2
    })
    await settle(page)
    const rows = await expectContiguous(page)
    // real heights differ from the estimate, so "middle" is approximate
    expect(rows[0].index).toBeGreaterThan(400_000)
    expect(rows[0].index).toBeLessThan(600_000)
  })

  test('scrollToIndex lands the row at the top, anywhere in 1M rows', async ({ page }) => {
    await open(page)
    for (const target of [123_456, 999_000, 1, 654_321]) {
      await page.evaluate((i) => window.__demo!.scrollToIndex(i, 'start'), target)
      await settle(page)
      const rows = await expectContiguous(page)
      if (rows[0].index !== target) console.log(target, JSON.stringify(rows.slice(0, 3)))
      expect(rows[0].index).toBe(target)
      expect(Math.abs(rows[0].top)).toBeLessThan(1.5)
    }
  })

  test('wheel scrolling deep in the list keeps rows contiguous', async ({ page }) => {
    await open(page)
    await page.evaluate(() => window.__demo!.scrollToIndex(700_000, 'start'))
    await settle(page)
    const box = (await page.getByTestId('viewport').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    for (let i = 0; i < 16; i++) {
      await page.mouse.wheel(0, i < 8 ? 400 : -400)
      await settle(page)
      await expectContiguous(page)
    }
  })
})

test.describe('scroll anchoring', () => {
  test('a row growing above the viewport does not move visible content', async ({ page }) => {
    await open(page)
    await page.evaluate(() => window.__demo!.scrollToIndex(500_000, 'start'))
    await settle(page)
    const before = await visibleRows(page)
    // 499_998 is rendered (overscan) but sits above the viewport
    await page.evaluate(() => window.__demo!.setExtra(499_998, 300))
    await settle(page)
    const after = await visibleRows(page)
    expect(after[0].index).toBe(before[0].index)
    expect(Math.abs(after[0].top - before[0].top)).toBeLessThan(1.01)
    const grown = await page.evaluate(
      () => document.querySelector<HTMLElement>('.row[data-index="499998"]')!.getBoundingClientRect().height,
    )
    expect(grown).toBeGreaterThan(300)
  })

  test('scrolling up into unmeasured rows moves content smoothly, without jumps', async ({ page }) => {
    await open(page)
    await page.evaluate(() => window.__demo!.scrollToIndex(300_000, 'start'))
    await settle(page)
    // Every row above is unmeasured (estimated 40px, real 40–200px). As they scroll in and get
    // measured, anchoring must keep each step's movement equal to the scroll distance.
    const ratio = await page.evaluate(() => {
      const s = window.__demo!.stats()
      return s.totalSize / s.scrollHeight
    })
    for (let step = 0; step < 12; step++) {
      const rows = await visibleRows(page)
      const anchor = rows[rows.length - 1].index
      const moved = await page.evaluate(async (idx) => {
        const el = window.__demo!.scrollEl
        const top = () => document.querySelector<HTMLElement>(`.row[data-index="${idx}"]`)!.getBoundingClientRect().top
        const t0 = top()
        el.scrollTop -= 50
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        return top() - t0
      }, anchor)
      // 50 DOM px map to ≈ 50 × ratio virtual px
      expect(moved).toBeGreaterThan(50 * ratio * 0.8)
      expect(moved).toBeLessThan(50 * ratio * 1.25)
      await expectContiguous(page)
    }
  })
})

test.describe('reference: TanStack Virtual', () => {
  test('cannot reach the last row of 1M variable rows (no height scaling)', async ({ page, browserName }) => {
    await open(page, 'tanstack')
    await page.evaluate(() => {
      const el = window.__demo!.scrollEl
      el.scrollTop = el.scrollHeight
    })
    await settle(page)
    const rows = await visibleRows(page)
    const lastVisible = rows[rows.length - 1].index
    console.log(`[${browserName}] TanStack: bottom of the scrollbar shows row #${lastVisible.toLocaleString('en-US')}`)
    expect(lastVisible).toBeLessThan(999_999)
  })
})
