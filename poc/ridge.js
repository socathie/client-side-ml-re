/*
 * ridge.js — a standalone re-implementation of WebGazer's gaze regression.
 *
 * This file contains NO WebGazer code. It is an independent re-derivation of the
 * math WebGazer performs internally, written only from the observed behaviour and
 * the public algorithm (ridge regression). Its purpose in this demo is to show
 * that once the calibration training set is extracted from a running client, the
 * gaze model can be reproduced and run entirely outside WebGazer, with byte-for-
 * byte identical predictions.
 *
 * WebGazer computes, on every predict() call:
 *     coef = (XT X + kI)^-1 XT y
 *     prediction = dot(queryFeatures, coef)
 * separately for the screen-x and screen-y targets. k is the ridge parameter
 * (WebGazer default 1e-5). X is the matrix of stored calibration eye-feature
 * vectors; y is the matching vector of clicked screen coordinates.
 */

const Ridge = (function () {
  function transpose(A) {
    const rows = A.length, cols = A[0].length;
    const T = Array.from({ length: cols }, () => new Array(rows));
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) T[j][i] = A[i][j];
    return T;
  }

  function matMul(A, B) {
    const n = A.length, m = B[0].length, p = B.length;
    const C = Array.from({ length: n }, () => new Array(m).fill(0));
    for (let i = 0; i < n; i++)
      for (let k = 0; k < p; k++) {
        const a = A[i][k];
        if (a === 0) continue;
        for (let j = 0; j < m; j++) C[i][j] += a * B[k][j];
      }
    return C;
  }

  // Solve A x = b for a symmetric positive-definite A via Gaussian elimination
  // with partial pivoting. A is n x n, b is n x 1 (column vector).
  function solve(A, b) {
    const n = A.length;
    // Build augmented matrix.
    const M = A.map((row, i) => row.concat([b[i][0]]));
    for (let col = 0; col < n; col++) {
      // Partial pivot.
      let pivot = col;
      for (let r = col + 1; r < n; r++)
        if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
      if (pivot !== col) { const t = M[pivot]; M[pivot] = M[col]; M[col] = t; }
      const diag = M[col][col];
      if (Math.abs(diag) < 1e-12) throw new Error("singular matrix");
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const factor = M[r][col] / diag;
        if (factor === 0) continue;
        for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
      }
    }
    const x = new Array(n);
    for (let i = 0; i < n; i++) x[i] = M[i][n] / M[i][i];
    return x;
  }

  // Ridge coefficients for feature matrix X (samples x features) and target y
  // (length = samples). Mirrors WebGazer's util_regression.ridge.
  function ridgeCoefficients(y, X, k) {
    const nc = X[0].length;
    const Xt = transpose(X);                 // features x samples
    const ss = matMul(Xt, X);                // features x features (Gram)
    for (let i = 0; i < nc; i++) ss[i][i] += k;
    const yCol = y.map((v) => [v]);
    const bb = matMul(Xt, yCol);             // features x 1
    const solution = solve(ss, bb);          // features
    return solution;
  }

  function dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  // A fully standalone gaze model reconstructed from an extracted calibration set.
  // model = { features: [[...]], screenX: [...], screenY: [...], ridgeParameter }
  function ExtractedGazeModel(model) {
    const k = model.ridgeParameter;
    const coefX = ridgeCoefficients(model.screenX, model.features, k);
    const coefY = ridgeCoefficients(model.screenY, model.features, k);
    return {
      coefX,
      coefY,
      // Predict a screen point for a query eye-feature vector, exactly as
      // WebGazer would (minus the optional Kalman smoothing).
      predict(queryFeatures) {
        return {
          x: Math.floor(dot(queryFeatures, coefX)),
          y: Math.floor(dot(queryFeatures, coefY)),
        };
      },
    };
  }

  return { transpose, matMul, solve, ridgeCoefficients, dot, ExtractedGazeModel };
})();

// Allow use both in the browser (global) and in Node (module.exports) so the
// same extractor can be replayed headless.
if (typeof module !== "undefined" && module.exports) module.exports = Ridge;
