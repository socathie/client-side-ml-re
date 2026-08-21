# Harder targets: WASM extraction and obfuscation RE

The brief names the target as "JS / **WASM**" and is for an age-assurance /
anti-fraud product — i.e. one likely built with **obfuscation and integrity
systems**. WebGazer is neither WASM nor obfuscated, so on its own it demonstrates
the *easy* version of exactly the two things the client is most worried about.

This document closes that gap. Because a real product's staging build can't be
published, each capability is exercised against a **purpose-built stand-in** that
presents the same RE surface: a model compiled to WebAssembly, and a model hidden
in an obfuscated JavaScript bundle. These are constructed targets — the point is
the technique, run for real and reproducible, not a claim to have already broken
the client's specific product. Both run headless; commands at the end.

## A. Extracting a model shipped as WebAssembly

Target: [`poc/wasm/agemodel.wasm`](poc/wasm/) — a real "age = w·features + bias"
model written in WAT and compiled with `wat2wasm`, with its learned parameters in
a data segment. This is the shape a shipped WASM model presents.

Demonstrated in [`poc/wasm/extract.js`](poc/wasm/extract.js), verified by
[`poc/wasm/verify.node.js`](poc/wasm/verify.node.js) and
[`poc/wasm/run.html`](poc/wasm/run.html):

1. **Static extraction — no execution.** Parse the `.wasm` binary directly: walk
   the section headers (LEB128), find the Data section, and carve the five
   little-endian `f64` parameters out of the segment bytes. Recovered
   `[0.8, 1.5, -0.3, 2.1]` + bias `18.0` from the binary alone.
2. **Dynamic extraction — live linear memory.** Instantiate the module and read
   the weights straight out of `WebAssembly.Memory` as a `Float64Array`. Agrees
   with the static carve.
3. **Run it outside WASM.** A pure-JS re-implementation of the model reproduces
   the module's output exactly (`predict(1, 0.5, 2, 0.25) = 19.475`).
4. **Forge the age.** Overwrite the weights in linear memory; the module itself is
   untouched, yet `predict()` now returns the attacker's chosen age (21). A gate
   that trusts an on-device age reads the forged number.

The transferable point: compiling a model to WebAssembly hides it from a casual
reader but not from RE. The weights are in the binary (static) and in linear
memory (dynamic); both are recoverable, and linear memory is writable, so the
result is forgeable. WASM raises the effort of *locating*, not the possibility of
*extracting or tampering*.

## B. Recovering a model from an obfuscated bundle

Target: [`poc/obfuscated/agecheck.obf.js`](poc/obfuscated/) — the same age model,
run through [`obfuscate.js`](poc/obfuscated/obfuscate.js), which applies the
layers a tool like `javascript-obfuscator` would: the weights are packed to
bytes, XORed with a key and base64-encoded into a blob; the formula is assembled
at runtime via `new Function`; strings sit behind a rotated string-array
indirection; identifiers are mangled to `_0x` hex. (The transform is authored in
the repo rather than pulled from npm so there is no build dependency; production
obfuscators additionally do control-flow flattening, which method 2 below defeats
regardless.)

[`deobfuscate.js`](poc/obfuscated/deobfuscate.js) recovers the model two
independent ways, neither of which reads the original source:

1. **Static (white-box).** Treat the obfuscated file as text: pull the base64 blob
   and the XOR key out as literals, decode, and read the `f64` weights. Recovered
   `[0.8, 1.5, -0.3, 2.1]` + bias `18`, key `0x5b`, without executing anything.
2. **Black-box.** Call *only* the exported `estimateAge()` and recover each weight
   by finite differences (scale a unit input up to beat the output rounding).
   Recovers the same weights. This works no matter how the internals are mangled
   or control-flow-flattened, because it depends only on observable behaviour —
   which is why obfuscation is a delay, not a defense, against model extraction.

Both methods reproduce the obfuscated bundle's predictions exactly.

## What this establishes for the engagement

- The **WASM** and **obfuscation** capabilities the brief centers on are
  demonstrated here end to end, not just described.
- What is genuinely engagement-specific — and not claimable from a sample — is
  applying these to the client's actual staging build: their real WASM module,
  their real obfuscation/anti-debug, their real integrity checks. That is the
  paid work, and Day 1 would establish which of these techniques their build
  actually resists.
- The recommendations in [REPORT.md](REPORT.md) hold and are reinforced: guard the
  **input** (real-sensor / liveness), move the trust decision **server-side** when
  the stakes require it, and treat obfuscation and WASM as speed bumps with honest
  expiry dates, not walls.

## Reproduce

```
# WASM: (re)compile the model, then extract + tamper
wat2wasm poc/wasm/agemodel.wat -o poc/wasm/agemodel.wasm   # optional; .wasm is committed
node poc/wasm/verify.node.js
python3 -m http.server 8893   # then open http://localhost:8893/poc/wasm/run.html

# Obfuscation: (re)generate the bundle, then recover the model from it
node poc/obfuscated/obfuscate.js      # optional; agecheck.obf.js is committed
node poc/obfuscated/deobfuscate.js
```
