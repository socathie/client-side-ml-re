/*
 * verify.node.js — headless proof of the WASM model extraction and tamper.
 * Run:  node poc/wasm/verify.node.js
 */
const fs = require("fs");
const path = require("path");
const WasmRE = require("./extract.js");

const wasmBytes = new Uint8Array(fs.readFileSync(path.join(__dirname, "agemodel.wasm")));
let failures = 0;
const check = (name, ok) => { console.log((ok ? "  ok   " : "  FAIL ") + name); if (!ok) failures++; };
const approx = (a, b) => Math.abs(a - b) < 1e-9;

(async () => {
  const { instance } = await WebAssembly.instantiate(wasmBytes);
  const wasmPredict = instance.exports.predict;
  const memory = instance.exports.memory;
  const features = [1.0, 0.5, 2.0, 0.25];

  // 1. Static carve from the binary (no execution) recovers the weights.
  const carved = WasmRE.staticCarve(wasmBytes);
  console.log("  static-carved params:", carved.map((v) => Math.round(v * 100) / 100));
  check("static carve recovers 5 parameters", carved.length === 5);

  // 2. Dynamic dump from linear memory agrees with the static carve.
  const dumped = WasmRE.dynamicDump(memory);
  check("linear-memory dump == static carve", carved.every((v, i) => approx(v, dumped[i])));

  // 3. Standalone re-implementation reproduces the WASM module's output.
  const truth = wasmPredict(...features);
  const mine = WasmRE.predict(carved, features);
  console.log("  WASM predict =", truth, "| extracted model =", mine);
  check("extracted model reproduces WASM output exactly", approx(truth, mine));

  // 4. Tamper: overwrite the weights in linear memory so the untouched module
  //    reports an attacker-chosen age.
  const TARGET_AGE = 21.0;
  // Force predict(features) == TARGET by making bias absorb the difference.
  const forged = carved.slice();
  forged[4] += TARGET_AGE - truth;
  WasmRE.tamper(memory, forged);
  const after = wasmPredict(...features);
  console.log("  after tamper, WASM predict =", after);
  check("tampered module returns the forged age", approx(after, TARGET_AGE));

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : "\n" + failures + " CHECK(S) FAILED");
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
