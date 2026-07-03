export function round2(n: number): number {
  // Round half away from zero, symmetrically for positive and negative values.
  // The epsilon nudge counters float representation error (e.g. 1.005 -> 1.01);
  // applying it to the magnitude keeps negatives (e.g. a negative round-off) consistent.
  return Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100
}
