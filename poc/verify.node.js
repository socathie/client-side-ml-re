/*
 * verify.node.js — headless correctness check for the extracted-model math.
 *
 * The browser demo proves the standalone model matches WebGazer's own predict().
 * This proves the standalone math is internally correct without any browser:
 * build a known linear dataset, fit it with ridge.js, and confirm the model
 * recovers the mapping and that the least-norm input-forgery hits its target.
 *
 * Run:  node poc/verify.node.js
 */

const Ridge = require("./ridge.js");

function approx(a, b, tol) { return Math.abs(a - b) <= tol; }
let failures = 0;
function check(name, cond) {
  console.log((cond ? "  ok   " : "  FAIL ") + name);
  if (!cond) failures++;
}

// Known ground-truth linear mapping, tiny ridge so the fit is near-exact.
const D = 6, N = 12, k = 1e-5;
const trueCoefX = [220, -60, 15, 90, -25, 400];
const trueCoefY = [-80, 300, 40, -20, 120, 250];
let seed = 20260821;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const features = [], screenX = [], screenY = [];
for (let i = 0; i < N; i++) {
  const f = Array.from({ length: D }, () => Math.round(rnd() * 100) / 100);
  features.push(f);
  screenX.push(Math.floor(f.reduce((s, v, j) => s + v * trueCoefX[j], 0)));
  screenY.push(Math.floor(f.reduce((s, v, j) => s + v * trueCoefY[j], 0)));
}

const model = Ridge.ExtractedGazeModel({ ridgeParameter: k, features, screenX, screenY });

// 1. The model reproduces every training point within rounding.
let reproduced = 0;
for (let i = 0; i < N; i++) {
  const p = model.predict(features[i]);
  if (approx(p.x, screenX[i], 1) && approx(p.y, screenY[i], 1)) reproduced++;
}
check("model reproduces all training points (" + reproduced + "/" + N + ")", reproduced === N);

// 2. The fitted model generalises: predictions on fresh (non-training) points
//    stay within a few pixels of the true mapping. (Coefficients are not checked
//    exactly: flooring the calibration targets to integer pixels plus ridge
//    shrinkage perturbs them slightly, exactly as in the real client.)
let generalises = true, maxErr = 0;
for (let i = 0; i < 5; i++) {
  const f = Array.from({ length: D }, () => Math.round(rnd() * 100) / 100);
  const trueX = f.reduce((s, v, j) => s + v * trueCoefX[j], 0);
  const trueY = f.reduce((s, v, j) => s + v * trueCoefY[j], 0);
  const p = model.predict(f);
  maxErr = Math.max(maxErr, Math.abs(p.x - trueX), Math.abs(p.y - trueY));
  if (!approx(p.x, trueX, 3) || !approx(p.y, trueY, 3)) generalises = false;
}
check("model generalises to held-out points (max err " + Math.round(maxErr * 100) / 100 + "px)", generalises);

// 3. Least-norm input forgery hits an arbitrary target exactly (Stage-3 tech 3).
const TARGET = { x: 1234, y: 567 };
const A = [model.coefX, model.coefY];
const At = Ridge.transpose(A);
const lambda = Ridge.solve(Ridge.matMul(A, At), [[TARGET.x], [TARGET.y]]);
const qStar = At.map((row) => row[0] * lambda[0] + row[1] * lambda[1]);
const forged = model.predict(qStar);
check("input forgery reaches target exactly", approx(forged.x, TARGET.x, 1) && approx(forged.y, TARGET.y, 1));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : "\n" + failures + " CHECK(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
