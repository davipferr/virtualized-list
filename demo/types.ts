/** Test/benchmark hooks exposed on window.__demo by whichever list is mounted. */
export interface DemoApi {
  impl: 'ours' | 'tanstack'
  scrollEl: HTMLElement
  scrollToIndex(index: number, align?: 'start' | 'center' | 'end'): void
  stats(): { totalSize: number; scrollHeight: number; isScaled: boolean; rendered: number }
}

export interface ListProps {
  count: number
  extras: ReadonlyMap<number, number>
  onApi(api: DemoApi): void
}
