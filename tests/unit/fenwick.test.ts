import { describe, expect, it } from 'vitest'
import { FenwickTree } from '../../src/core/fenwick'

function rng(seed: number) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
}

describe('FenwickTree', () => {
  it('matches a naive prefix-sum array under random updates', () => {
    const rand = rng(42)
    const n = 1000
    const naive = Array.from({ length: n }, () => Math.floor(rand() * 100) + 1)
    const tree = new FenwickTree(naive)
    for (let step = 0; step < 2000; step++) {
      const i = Math.floor(rand() * n)
      const v = Math.floor(rand() * 200)
      naive[i] = v
      tree.set(i, v)
      const q = Math.floor(rand() * (n + 1))
      expect(tree.prefixSum(q)).toBe(naive.slice(0, q).reduce((a, b) => a + b, 0))
    }
    expect(tree.total).toBe(naive.reduce((a, b) => a + b, 0))
  })

  it('lowerBound returns the row containing an offset', () => {
    const tree = new FenwickTree([10, 20, 30, 40]) // starts: 0, 10, 30, 60; total 100
    expect(tree.lowerBound(0)).toBe(0)
    expect(tree.lowerBound(9.99)).toBe(0)
    expect(tree.lowerBound(10)).toBe(1)
    expect(tree.lowerBound(29)).toBe(1)
    expect(tree.lowerBound(30)).toBe(2)
    expect(tree.lowerBound(99)).toBe(3)
    expect(tree.lowerBound(1e9)).toBe(3) // clamped
  })

  it('lowerBound agrees with linear search on random data', () => {
    const rand = rng(7)
    const n = 777
    const vals = Array.from({ length: n }, () => 1 + Math.floor(rand() * 80))
    const tree = new FenwickTree(vals)
    const total = tree.total
    for (let k = 0; k < 500; k++) {
      const target = rand() * total
      let acc = 0
      let expected = 0
      while (expected < n - 1 && acc + vals[expected] <= target) acc += vals[expected++]
      expect(tree.lowerBound(target)).toBe(expected)
    }
  })

  it('handles 1M rows quickly', () => {
    const t0 = performance.now()
    const tree = new FenwickTree(new Float64Array(1_000_000).fill(40))
    for (let i = 0; i < 100_000; i++) tree.set((i * 7919) % 1_000_000, 30 + (i % 50))
    for (let i = 0; i < 100_000; i++) tree.lowerBound(i * 397)
    expect(performance.now() - t0).toBeLessThan(1000)
  })
})
