# Real reverse-engineering pass: the shipped artifact

This document records an actual RE pass, not a synthetic demonstration. Where
[REPORT.md](REPORT.md) proves the tampering *method* by driving WebGazer's live
regression object, this works the **shipped bytes**: recover the model from
`webgazer.min.js` as if the source were not on GitHub, then extract and run the
real shipped neural network. Every number below is from doing it, not reading the
source.

## 1. Static recovery from `webgazer.min.js`

The bundle is the webpack/terser production build (~1.9 MB): scope-local variables
are crushed to `e`/`t`/`n`, but **class and property names survive** — so the
model is recoverable by name from the artifact alone. Grepping the shipped file:

| What | Recovered from the bundle | Occurrences |
|------|---------------------------|-------------|
| Gaze model class | `RidgeReg` | 19 |
| Calibration store (in-memory) | `eyeFeaturesClicks`, `screenXClicksArray` | 10 / 6 |
| Ridge hyperparameter | `ridgeParameter` | 5 |
| Feature builder | `getEyeFeats` | 7 |
| Face model wrapper | `TFFaceMesh` | 4 |

Two findings an attacker cares about, both read straight out of the bundle:

- **Where the on-disk model lives.** WebGazer persists calibration via localforage
  under the keys `webgazerGlobalData` and `webgazerGlobalSettings`. That is
  IndexedDB in the browser profile: the trained gaze model can be read (or
  overwritten for a persistent tamper) from disk, outside any running session.
- **Where the neural network comes from.** The face-landmark model source is
  hardcoded. The bundle contains the tfhub endpoints
  `.../face_landmarks_detection/face_mesh/1` and `.../attention_mesh/1`, plus the
  mediapipe solution path `faceMeshSolutionPath: "./mediapipe/face_mesh"`. So the
  model URL is not a secret; it is a string in the shipped JavaScript.

## 2. Extracting the real shipped neural network

Following that hardcoded endpoint, [`poc/facemesh/extract.sh`](poc/facemesh/extract.sh)
pulls the actual model. tfhub 302-redirects to signed Google Cloud Storage URLs;
`?tfjs-format=file` returns the raw TensorFlow.js graph-model files. No auth, no
WebGazer, no webcam. What comes back is a complete, real model:

- **Format:** TF.js `graph-model`, 241 graph nodes, 11 op types.
- **Architecture:** a MobileNet-style depthwise-separable CNN — 31 fused
  convolutions, 24 depthwise convolutions, 24 PReLU activations, 7 max-pools.
- **Parameters:** **738,949** across 120 weight tensors.
- **Quantization:** 114 tensors are declared float32 but stored **float16** on the
  wire (6 int32 tensors unquantized) — a single `group1-shard1of1.bin` of
  1,477,958 bytes, i.e. ~2 bytes per parameter, halving the download.
- **Interface (recovered, not guessed):** input `input_1 [-1, 192, 192, 3]` (a
  192×192 RGB face crop); outputs `output_mesh [-1, 1404]` (468 landmarks × 3),
  `output_faceflag [-1, 1]` (face-presence confidence), `output_contours [-1, 266]`.

### It runs outside the app

[`poc/facemesh/run.html`](poc/facemesh/run.html) loads the extracted model in a
bare page (TF.js from a CDN, nothing else) and executes it on a synthetic
192×192×3 input. It returns the real output shapes `[1,1404]`, `[1,1]`, `[1,266]`
— 468 face landmarks decoded from the shipped weights, with no WebGazer present.
The model is not just downloadable; it is executable standalone.

## 3. What this establishes

- The **stock** component (FaceMesh) is trivially liftable: its source URL is a
  string in the bundle and its weights are unauthenticated public files. If a
  product treats "our model is client-side, so it's hidden" as protection, it is
  not — for the shipped-weights case this is a one-command extraction.
- The **product-specific** model in WebGazer is the runtime-calibrated ridge
  regression, not the FaceMesh net. Its extraction and the three tampering
  techniques are the subject of [REPORT.md](REPORT.md) and
  [`poc/`](poc/). This pass is the "shipped artifact" half; that is the "live
  model" half.
- Plain minification did not obstruct any of this. The bar that would is
  property-name mangling, control-flow obfuscation, or WASM — the harder-target
  work described in REPORT.md.

## Reproduce

```
# extract the real model from the endpoint hardcoded in webgazer.min.js
bash poc/facemesh/extract.sh

# load and run it standalone (serve over HTTP, then open the page)
python3 -m http.server 8892
# open http://localhost:8892/poc/facemesh/run.html
```

The extracted weights are intentionally **not** committed (they are a ~1.5 MB
third-party Apache-2.0 model); `extract.sh` reproduces them on demand, and
`run.html` falls back to loading live from the same endpoint WebGazer uses.
