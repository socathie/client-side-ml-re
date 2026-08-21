/*
 * extract.js — reverse-engineer and extract a model shipped as WebAssembly.
 *
 * Target: agemodel.wasm, an "age = w·features + bias" model compiled to WASM with
 * its learned parameters in a data segment. Runs in Node (require) and the browser
 * (global `WasmRE`). Three capabilities, matching the brief's three areas:
 *
 *   staticCarve(bytes)   — recover the weights from the .wasm binary WITHOUT
 *                          executing it, by parsing the module's Data section.
 *   dynamicDump(memory)  — recover the weights from WebAssembly linear memory at
 *                          runtime.
 *   predict(w, features) — a standalone re-implementation (no WASM) to confirm the
 *                          extracted weights reproduce the module's output.
 *   tamper(memory, w)    — overwrite the weights in linear memory so the untouched
 *                          module returns an attacker-chosen age.
 */

const WasmRE = (function () {
  // --- minimal WASM binary reader: just enough to reach the Data section ---
  function leb(bytes, i) {            // unsigned LEB128 -> {value, next}
    let result = 0, shift = 0, b;
    do { b = bytes[i++]; result |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    return { value: result >>> 0, next: i };
  }

  // Locate the active data segment's raw bytes in a .wasm module.
  function findDataSegment(bytes) {
    if (bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d)
      throw new Error("not a wasm module (bad magic)");
    let i = 8;                        // skip magic (4) + version (4)
    while (i < bytes.length) {
      const id = bytes[i++];
      const sz = leb(bytes, i); i = sz.next;
      const end = i + sz.value;
      if (id === 11) {                // Data section
        let p = i;
        const count = leb(bytes, p); p = count.next;
        // first segment only (that is where the model lives here)
        const flags = leb(bytes, p); p = flags.next;   // 0 = active, memory 0
        // active segment: an offset expr terminated by 0x0b (end)
        if (flags.value === 0) {
          while (bytes[p] !== 0x0b) p++;   // skip the i32.const offset expr
          p++;                             // consume 0x0b
        }
        const len = leb(bytes, p); p = len.next;
        return bytes.slice(p, p + len.value);
      }
      i = end;
    }
    throw new Error("no data section found");
  }

  function bytesToF64(seg, n) {
    const dv = new DataView(seg.buffer, seg.byteOffset, seg.byteLength);
    const out = [];
    for (let k = 0; k < n; k++) out.push(dv.getFloat64(k * 8, true /*LE*/));
    return out;
  }

  // Recover [w0,w1,w2,w3,bias] straight from the binary, no execution.
  function staticCarve(wasmBytes, nParams = 5) {
    const seg = findDataSegment(wasmBytes);
    return bytesToF64(seg, nParams);
  }

  // Recover the same parameters from live linear memory.
  function dynamicDump(memory, nParams = 5) {
    return Array.from(new Float64Array(memory.buffer, 0, nParams));
  }

  // Standalone re-implementation of the model (no WASM).
  function predict(params, features) {
    let age = params[4]; // bias
    for (let i = 0; i < features.length; i++) age += features[i] * params[i];
    return age;
  }

  // Overwrite the weights in linear memory; the module itself is untouched.
  function tamper(memory, newParams) {
    new Float64Array(memory.buffer, 0, newParams.length).set(newParams);
  }

  return { findDataSegment, staticCarve, dynamicDump, predict, tamper };
})();

if (typeof module !== "undefined" && module.exports) module.exports = WasmRE;
