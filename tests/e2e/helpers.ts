import { expect, type Page } from '@playwright/test'

export async function open(page: Page, impl: 'ours' | 'tanstack' = 'ours', count = 1_000_000) {
  await page.goto(`/?impl=${impl}&count=${count}`)
  await page.waitForFunction(() => !!window.__demo && document.querySelectorAll('.row').length > 0)
  await settle(page)
}

/** Wait until the rendered rows stop moving across consecutive animation frames. */
export async function settle(page: Page) {
  await page.evaluate(async () => {
    const snap = () =>
      [...document.querySelectorAll<HTMLElement>('.row')]
        .map((r) => `${r.dataset.index}@${Math.round(r.getBoundingClientRect().top)}`)
        .join()
    const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)))
    let prev = ''
    for (let i = 0; i < 60; i++) {
      await frame()
      await frame()
      const s = snap()
      if (s === prev) return
      prev = s
    }
  })
}

export interface RowRect {
  index: number
  top: number
  bottom: number
  vpHeight: number
}

/** Rows currently intersecting the viewport, with viewport-relative rects. */
export async function visibleRows(page: Page): Promise<RowRect[]> {
  return page.evaluate(() => {
    const el = window.__demo!.scrollEl
    const vp = el.getBoundingClientRect()
    const top = vp.top + el.clientTop
    return [...document.querySelectorAll<HTMLElement>('.row')]
      .map((r) => {
        const b = r.getBoundingClientRect()
        return { index: Number(r.dataset.index), top: b.top - top, bottom: b.bottom - top, vpHeight: el.clientHeight }
      })
      .filter((r) => r.bottom > 0 && r.top < r.vpHeight)
      .sort((a, b) => a.index - b.index)
  })
}

/** Visible rows must tile the viewport: consecutive indices, each starting where the previous ends. */
export async function expectContiguous(page: Page): Promise<RowRect[]> {
  const rows = await visibleRows(page)
  expect(rows.length).toBeGreaterThan(0)
  for (let k = 1; k < rows.length; k++) {
    expect(rows[k].index).toBe(rows[k - 1].index + 1)
    expect(Math.abs(rows[k].top - rows[k - 1].bottom)).toBeLessThan(1.01)
  }
  expect(rows[0].top).toBeLessThanOrEqual(0.5)
  const last = rows[rows.length - 1]
  if (last.index !== 999_999) expect(last.bottom).toBeGreaterThanOrEqual(last.vpHeight - 0.5)
  return rows
}
