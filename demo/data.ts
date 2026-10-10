const WORDS =
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat'.split(
    ' ',
  )

/** Cheap deterministic hash so row i always has the same content. */
function hash(i: number): number {
  let x = (i + 1) * 0x9e3779b1
  x ^= x >>> 15
  x = Math.imul(x, 0x85ebca6b)
  x ^= x >>> 13
  return x >>> 0
}

/** Variable-length text: 1 to ~5 wrapped lines, so real heights differ from the estimate. */
export function rowText(i: number): string {
  const h = hash(i)
  const words = 3 + (h % 9 === 0 ? 60 : h % 25)
  let s = ''
  for (let w = 0; w < words; w++) s += (w ? ' ' : '') + WORDS[(h >>> (w % 24)) % WORDS.length]
  return s
}

export const ESTIMATE = 40
