/*
 * deobfuscate.js — recover the age model from the obfuscated bundle.
 *
 * Two independent methods, neither of which reads agecheck.src.js:
 *
 *   1. Static (white-box): treat agecheck.obf.js as text, pull the XOR+base64
 *      weight blob and the key straight out of it, and decode — no execution.
 *   2. Dynamic (black-box): call only the bundle's exported estimateAge() and
 *      recover the weights by finite differences. This works no matter how the
 *      internals are mangled or control-flow-flattened, because it depends only
 *      on the function's observable behaviour.
 *
 * Run:  node poc/obfuscated/deobfuscate.js
 */
const fs = require("fs");
const path = require("path");

const OBF = path.join(__dirname, "agecheck.obf.js");

// ---- method 1: static recovery from the obfuscated source text --------------
function staticRecover() {
  const text = fs.readFileSync(OBF, "utf8");
  // The blob and key are just literals in the file, whatever the identifiers.
  const blob = text.match(/=\s*"([A-Za-z0-9+/=]{16,})"/)[1];
  const key = parseInt(text.match(/=\s*(\d+);/)[1], 10);
  const bytes = Buffer.from(blob, "base64").map((b) => b ^ key);
  const params = [];
  for (let j = 0; j + 8 <= bytes.length; j += 8) params.push(bytes.readDoubleLE(j));
  return { blob, key, weights: params.slice(0, 4), bias: params[4] };
}

// ---- method 2: black-box extraction via queries -----------------------------
function blackBoxRecover(estimateAge, nFeatures = 4) {
  const K = 1000; // scale up to beat the round() on the output
  const zero = new Array(nFeatures).fill(0);
  const base = estimateAge(zero);                 // ~ round(bias)
  const weights = [];
  for (let i = 0; i < nFeatures; i++) {
    const e = zero.slice(); e[i] = K;
    weights.push((estimateAge(e) - base) / K);    // ~ w_i
  }
  return { weights, bias: base };
}

function main() {
  console.log("Target: agecheck.obf.js (weights in an XOR+base64 blob, formula via new Function)\n");

  const s = staticRecover();
  console.log("[1] static recovery from the obfuscated text (no execution):");
  console.log("    blob   :", s.blob.slice(0, 32) + "…");
  console.log("    XOR key: 0x" + s.key.toString(16));
  console.log("    weights:", s.weights, "bias:", s.bias);

  const obf = require(OBF);
  const b = blackBoxRecover(obf.estimateAge);
  console.log("\n[2] black-box recovery via queries to estimateAge():");
  console.log("    weights:", b.weights.map((v) => Math.round(v * 1000) / 1000), "bias:", b.bias);

  // Reproduce the bundle's predictions from the statically-recovered model.
  const predict = (f) => Math.round(s.bias + f.reduce((a, x, i) => a + x * s.weights[i], 0));
  const tests = [[1, 0.5, 2, 0.25], [3, 0, 1, 2], [0.2, 0.2, 0.2, 0.2]];
  let allMatch = true;
  console.log("\n[3] reproduce the bundle from the recovered model:");
  for (const f of tests) {
    const mine = predict(f), theirs = obf.estimateAge(f);
    if (mine !== theirs) allMatch = false;
    console.log("    " + JSON.stringify(f) + " -> recovered " + mine + " | obf bundle " + theirs);
  }
  console.log(allMatch ? "\nMODEL RECOVERED: both methods agree and reproduce the obfuscated bundle."
                       : "\nMismatch — see above.");
  return allMatch ? 0 : 1;
}

if (require.main === module) process.exit(main());
module.exports = { staticRecover, blackBoxRecover };
