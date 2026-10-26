import { describe, expect, it } from "vitest";
import { pca } from "./pca.ts";

/** Points on a noisy plane embedded in `dim` dimensions; variance concentrated on two axes. */
function planeData(n: number, dim: number) {
  const a = Array.from({ length: dim }, (_, j) => (j % 7 === 0 ? 1 : 0.1));
  const b = Array.from({ length: dim }, (_, j) => (j % 5 === 0 ? -0.5 : 0.2));
  return Array.from({ length: n }, (_, i) => {
    const s = Math.sin(i) * 10;
    const t = Math.cos(i * 1.3) * 3;
    return a.map((av, j) => av * s + b[j] * t + (Math.random() - 0.5) * 0.01);
  });
}

describe("pca", () => {
  for (const dim of [32, 768]) {
    it(`concentrates variance in the first two components (dim=${dim})`, () => {
      const res = pca(planeData(400, dim), 10);
      expect(res.scores).toHaveLength(400);
      expect(res.scores[0]).toHaveLength(10);
      const [v1, v2, v3] = res.explainedVariance;
      expect(v1 + v2).toBeGreaterThan(0.99);
      expect(v1).toBeGreaterThanOrEqual(v2);
      expect(v3).toBeLessThan(0.01);
    });
  }

  it("exact and randomized paths agree on explained variance", () => {
    const data = planeData(300, 300);
    const small = pca(data.map((r) => r.slice(0, 200)), 3);
    const big = pca(data.map((r) => r.slice(0, 200)).map((r) => [...r, ...new Array(100).fill(0)]), 3);
    expect(big.explainedVariance[0]).toBeCloseTo(small.explainedVariance[0], 3);
    expect(big.explainedVariance[1]).toBeCloseTo(small.explainedVariance[1], 3);
  });

  it("handles degenerate input", () => {
    expect(pca([], 2).scores).toEqual([]);
    expect(pca([[1, 2, 3]], 2).scores).toEqual([[0, 0]]);
    expect(pca([[1, 1], [1, 1]], 2).explainedVariance).toEqual([0, 0]);
  });
});
