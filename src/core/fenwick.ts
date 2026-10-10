/**
 * Fenwick tree (binary indexed tree) over row sizes.
 *
 * - build:       O(n)
 * - add / set:   O(log n)
 * - prefixSum:   O(log n)   -> offset of row i
 * - lowerBound:  O(log n)   -> row containing a pixel offset
 *
 * A plain prefix-sum array would answer prefixSum in O(1) but every size update
 * would cost O(n), which is far too slow when 1M rows get measured as they scroll in.
 */
export class FenwickTree {
  /** 1-based internal tree. tree[i] holds the sum of a range ending at i-1. */
  private tree: Float64Array
  /** Raw values, so `set` can compute the delta and `get` is O(1). */
  private values: Float64Array
  private readonly n: number
  /** Highest power of two <= n, the starting step for the binary-lifting search. */
  private readonly topBit: number
  private sum = 0

  constructor(values: ArrayLike<number>) {
    this.n = values.length
    this.values = Float64Array.from(values)
    this.tree = new Float64Array(this.n + 1)
    // Linear-time construction: push each node's value into its parent once.
    for (let i = 1; i <= this.n; i++) {
      this.tree[i] += this.values[i - 1]
      const parent = i + (i & -i)
      if (parent <= this.n) this.tree[parent] += this.tree[i]
      this.sum += this.values[i - 1]
    }
    let bit = 1
    while (bit * 2 <= this.n) bit *= 2
    this.topBit = this.n === 0 ? 0 : bit
  }

  get length(): number {
    return this.n
  }

  get total(): number {
    return this.sum
  }

  get(index: number): number {
    return this.values[index]
  }

  /** Set the value at `index`, returning the delta that was applied. */
  set(index: number, value: number): number {
    const delta = value - this.values[index]
    if (delta !== 0) this.add(index, delta)
    return delta
  }

  add(index: number, delta: number): void {
    this.values[index] += delta
    this.sum += delta
    for (let i = index + 1; i <= this.n; i += i & -i) this.tree[i] += delta
  }

  /** Sum of values[0 .. index) — i.e. the start offset of row `index`. */
  prefixSum(index: number): number {
    let s = 0
    for (let i = Math.min(index, this.n); i > 0; i -= i & -i) s += this.tree[i]
    return s
  }

  /**
   * Largest `i` such that prefixSum(i) <= target, clamped to [0, n - 1].
   * In list terms: the index of the row that contains pixel `target`.
   */
  lowerBound(target: number): number {
    if (this.n === 0) return 0
    let pos = 0
    let remaining = target
    for (let step = this.topBit; step > 0; step >>= 1) {
      const next = pos + step
      if (next <= this.n && this.tree[next] <= remaining) {
        pos = next
        remaining -= this.tree[next]
      }
    }
    return Math.min(pos, this.n - 1)
  }
}
