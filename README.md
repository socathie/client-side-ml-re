# client-side-ml-re

Self-contained proofs of concept for **client-side ML security work**: locating an
on-device model inside a running browser client, extracting it and running it
outside the app, and forging the value it reports — across three delivery formats
a real product uses (plain JS, WebAssembly, and obfuscated JS).

The headline target is [WebGazer.js](https://webgazer.cs.brown.edu) (open source,
GPL-3.0), an in-browser webcam eye-tracker. Its architecture mirrors on-device
"estimate something from the camera, nothing leaves the device" products: webcam
in, an in-browser model, a numeric result out, nothing sent to a server. WebGazer
is used because it is legal to publish security work against; the WASM and
obfuscation cases use purpose-built stand-in targets.

- **[REPORT.md](REPORT.md)** — the write-up: what was done, how far it got, why it
  stopped, attacker effort per technique, and recommendations. Start here.
- **[RE-FINDINGS.md](RE-FINDINGS.md)** — a real RE pass on the shipped bytes:
  recovering the model from the minified bundle, then extracting and running the
  real shipped face-landmark neural network (738,949 params) outside WebGazer.
- **[HARDER-TARGETS.md](HARDER-TARGETS.md)** — the two hardest, most on-brief
  cases, demonstrated end to end: extracting a model compiled to **WebAssembly**
  (and forging its output via linear memory), and recovering a model from an
  **obfuscated** JS bundle (statically and by black-box query).
- **[poc/](poc/)** — the runnable proofs of concept: the tampering demo, the
  standalone extracted face-landmark model (`poc/facemesh/`), the WASM extraction
  (`poc/wasm/`), and the obfuscation RE (`poc/obfuscated/`).

## Run it

```
python3 -m http.server 8891
# open http://localhost:8891/poc/index.html
```

It runs with **no webcam**: WebGazer's genuine regression object is seeded with a
deterministic synthetic calibration set, so the run is identical for everyone. The
extraction and tamper code is exactly what would run against a live session.

Headless correctness check of the extracted-model math (no browser):

```
node poc/verify.node.js
```

## What it shows

1. **Locate** the product-specific model inside the running client (it is a
   ridge-regression gaze mapper rebuilt in memory from calibration clicks — never
   shipped as a weights file).
2. **Extract** it — read the calibration set off the live object and reproduce
   WebGazer's own `predict()` exactly with a standalone re-implementation
   ([`poc/ridge.js`](poc/ridge.js)) that contains no WebGazer code.
3. **Forge** the result three ways, weakest to strongest (output patch →
   calibration poisoning → input forgery), ranking each by how practical it is and
   what defends against it.

## Files

| Path | What it is |
|------|-----------|
| `REPORT.md` | The security write-up. |
| `poc/index.html` | Loads the genuine WebGazer bundle and runs the assessment on-page. |
| `poc/demo.js` | Drives WebGazer's real regression object through all three stages. |
| `poc/ridge.js` | Standalone re-implementation of the gaze regression (the "extracted model"). No WebGazer code. |
| `poc/verify.node.js` | Headless check that the standalone math is correct. |

## Licensing

This demo's own code is MIT-licensed (see [LICENSE](LICENSE)). WebGazer is
© the Brown WebGazer Team, GPL-3.0-or-later; it is loaded from a CDN at runtime
and **not redistributed** in this repository. This is security research against an
open-source library; no third-party service is touched.
