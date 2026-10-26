// PCA for the projection view. Shipping thousands of 1k+-dim vectors to the browser
// is tens of MB, so the server reduces to a few dozen principal components: the
// first two are the PCA plot, and all of them feed UMAP in a browser worker.
//
// High-dimensional input uses randomized SVD (Halko et al. 2011), which is
// accurate for the leading components and costs O(n·d·k) instead of O(d³).

import { EigenvalueDecomposition, Matrix, QrDecomposition, SingularValueDecomposition } from "ml-matrix";

export interface PcaResult {
  scores: number[][];
  explainedVariance: number[];
}

const EXACT_MAX_DIM = 256;

export function pca(vectors: number[][], components: number): PcaResult {
  const n = vectors.length;
  if (n === 0) return { scores: [], explainedVariance: [] };
  const d = vectors[0].length;
  // Always return `components` columns (zero-padded) so callers can index [0] and [1].
  const k = Math.max(1, Math.min(components, d));
  const kk = Math.min(k, n);

  const X = new Matrix(n, d);
  const mean = new Float64Array(d);
  for (const v of vectors) for (let j = 0; j < d; j++) mean[j] += v[j] / n;
  let totalVar = 0;
  for (let i = 0; i < n; i++) {
    const row = vectors[i];
    for (let j = 0; j < d; j++) {
      const c = row[j] - mean[j];
      X.set(i, j, c);
      totalVar += c * c;
    }
  }
  if (totalVar === 0 || n === 1) {
    return { scores: vectors.map(() => new Array(k).fill(0)), explainedVariance: new Array(k).fill(0) };
  }

  const { scores, singular } = d <= EXACT_MAX_DIM ? exact(X, kk) : randomized(X, kk);
  const pad = new Array(k - kk).fill(0);
  return {
    scores: scores.to2DArray().map((row) => (pad.length ? [...row, ...pad] : row)),
    explainedVariance: [...singular.map((s) => (s * s) / totalVar), ...pad],
  };
}

/** Eigen-decomposition of the d×d scatter matrix. */
function exact(X: Matrix, k: number) {
  const eig = new EigenvalueDecomposition(X.transpose().mmul(X), { assumeSymmetric: true });
  // ml-matrix returns ascending eigenvalues.
  const order = eig.realEigenvalues.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]).slice(0, k);
  const V = new Matrix(X.columns, k);
  order.forEach(([, idx], c) => {
    for (let r = 0; r < X.columns; r++) V.set(r, c, eig.eigenvectorMatrix.get(r, idx));
  });
  orientColumns(V);
  return { scores: X.mmul(V), singular: order.map(([v]) => Math.sqrt(Math.max(v, 0))) };
}

function randomized(X: Matrix, k: number, oversample = 10, powerIters = 2) {
  const l = Math.min(k + oversample, X.rows, X.columns);
  const omega = new Matrix(X.columns, l);
  for (let r = 0; r < X.columns; r++) for (let c = 0; c < l; c++) omega.set(r, c, gaussian());
  let Q = orth(X.mmul(omega));
  for (let i = 0; i < powerIters; i++) {
    Q = orth(X.mmul(orth(X.transpose().mmul(Q))));
  }
  const B = Q.transpose().mmul(X); // l × d
  const svd = new SingularValueDecomposition(B.transpose(), { autoTranspose: true });
  // B = U S Vᵀ, svd is of Bᵀ = V S Uᵀ, so its leftSingularVectors is V (d×l).
  const V = svd.leftSingularVectors.subMatrix(0, X.columns - 1, 0, k - 1);
  orientColumns(V);
  return { scores: X.mmul(V), singular: svd.diagonal.slice(0, k) };
}

function orth(Y: Matrix) {
  return new QrDecomposition(Y).orthogonalMatrix;
}

/** Deterministic signs so the plot does not flip between runs. */
function orientColumns(V: Matrix) {
  for (let c = 0; c < V.columns; c++) {
    let maxAbs = 0;
    let sign = 1;
    for (let r = 0; r < V.rows; r++) {
      const v = V.get(r, c);
      if (Math.abs(v) > maxAbs) {
        maxAbs = Math.abs(v);
        sign = Math.sign(v) || 1;
      }
    }
    if (sign < 0) for (let r = 0; r < V.rows; r++) V.set(r, c, -V.get(r, c));
  }
}

function gaussian() {
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}
