# Client-side model extraction and result tampering: a worked example on WebGazer

**Author:** Cathie So · **Target:** [WebGazer.js](https://webgazer.cs.brown.edu)
3.5.3 (GPL-3.0, open source) · **Scope:** the browser client, the on-device
model, and the value it outputs.

## What this is, and its one honest limitation

This is a work sample, not a real engagement report. It demonstrates the three
things a client-side ML security assessment actually turns on: **locate the model
inside a running browser client, extract it and run it outside the app, and forge
the value the model reports.** WebGazer is used as the target because it is legal
to publish work against (open source), and because its architecture is the same
shape as an on-device "estimate something from the camera, nothing leaves the
device" product: webcam in, an in-browser model, a numeric result out, nothing
sent to a server.

The limitation, stated up front rather than buried: the demo runs against
WebGazer's **minified** production bundle (`webgazer.min.js` — webpack/terser,
local variables crushed to `e`/`t`/`n`), but that bundle is **not obfuscated**.
Class and property names survive minification intact — `RidgeReg`,
`eyeFeaturesClicks`, `ridgeParameter`, `getEyeFeats` are all still there by name —
which is exactly why the extraction below works by name. The finding worth drawing
out: **plain minification is not a defense against this**, and the demo shows it
on the shipped minified build, not on unminified source. A real target may go
further — property-name mangling, control-flow obfuscation, or compilation to
WebAssembly — specifically to resist this. This sample therefore proves the
**model half** of the work end to end (find, extract, run, tamper) against a
minified build. It does not prove the **adversarial-RE half** (defeating
property-mangling / obfuscation / anti-tamper), which is a different and harder
problem. Where that line falls, and how I would approach the harder half, is set
out in "What would change on a hardened target" below.

Everything below is reproducible: open [`poc/index.html`](poc/index.html) (served
over HTTP) and it runs against the genuine `webgazer.min.js` from a CDN, with no
webcam. The numbers quoted are from that run.

## Stage 1 — reverse-engineer: where the model lives and runs

WebGazer's gaze pipeline has two stages:

1. **MediaPipe FaceMesh** (a TensorFlow.js model) turns each webcam frame into 468
   face landmarks, from which two eye patches are cut.
2. A **ridge-regression** gaze model maps the eye-patch pixel features to a screen
   `(x, y)`.

The security-relevant finding is *where the product-specific model actually is*.
The FaceMesh model is a stock, public, pretrained asset. The model that encodes
this product's behaviour is stage 2 — and **it is never shipped as a weights
file**. It is rebuilt in the browser from the user's own calibration clicks and
lives only in memory on the `RidgeReg` instance. A defender who assumes "our model
isn't downloadable because there's no model file" is wrong: the model is the
calibration set plus a fixed formula, and both are in the page.

Evidence of being inside the model, not the wrapping page (from the live run):
the ridge parameter `k = 1e-5`, the count of calibration samples held, and the
dimensionality of each stored eye-feature vector are all read directly off the
running object.

## Stage 2 — extract the model and run it locally

The gaze model recomputes its coefficients on every prediction as
`coef = (XᵀX + kI)⁻¹ Xᵀy`, where `X` is the stored calibration eye-features and
`y` the matching click coordinates. So extracting the model means reading that
calibration set out of the live object — nothing more.

[`poc/demo.js`](poc/demo.js) pulls `eyeFeaturesClicks`, `screenXClicksArray`,
`screenYClicksArray` and `ridgeParameter` straight off the instance, and
[`poc/ridge.js`](poc/ridge.js) — an independent re-implementation containing no
WebGazer code — reruns the math outside the library.

**Result:** the standalone model reproduces WebGazer's own `predict()` exactly,
on all nine calibration points and on a fresh live query (both return
`{x: 377, y: 99}`). The model has been lifted out of the app and runs on its own.

The point that matters for a client: "not shipped as a file" did not mean "not
extractable." Any value the model needs at inference time is, by construction,
reachable from JavaScript in the page.

### A note on the two extraction paths

WebGazer's product model happens to be *runtime-calibrated*, so extraction means
reading in-memory calibration data. A product whose model **is** shipped (a
`model.json` + weight shards loaded by TF.js, as an age or liveness model
typically would be) is the other case — and this demo performs it for real, not
just describes it. [RE-FINDINGS.md](RE-FINDINGS.md) recovers the model's source
URL straight out of the minified bundle, extracts the real shipped face-landmark
network (a 738,949-parameter, float16-quantized MobileNet-style CNN) from the
endpoint hardcoded there, and runs it standalone outside WebGazer. That is the
shipped-weights extraction path an age model would present, executed end to end.

## Stage 3 — forge the result in a way that would actually work

The client's real question is not "can you change the number" (anyone can) but
"can you change it in a way that survives the defences a serious product would
have." The demo shows three techniques, weakest to strongest, and what defeats
each. The target is to make the client report a gaze of `(1234, 567)` while the
user looks elsewhere.

| # | Technique | Result | Effort | What stops it | How practical |
|---|-----------|--------|--------|---------------|---------------|
| 1 | **Output patch** — overwrite `predict()` to return a constant | `(1234, 567)` | trivial | any integrity check on `predict`'s source | low — first thing a defender looks for |
| 2 | **Calibration poisoning** — feed crafted training points; model and `predict()` untouched | `(1233, 566)` | low | detecting anomalous calibration input | medium — the model *genuinely* computes it, so output-integrity checks pass |
| 3 | **Input forgery** — craft the eye-feature vector the honest model maps to the target; model, data and `predict()` all untouched | `(1234, 567)` exactly | low–medium | detecting that the *input* isn't a real eye | high — every internal value is self-consistent |

The ranking is the deliverable. Technique 1 is a party trick; technique 3 is the
one to worry about, because there is nothing anomalous *inside* the model to find
— the attack lives entirely at the sensor→feature boundary, upstream of anything
the model or an output check can see. This is the general truth of on-device ML:
**the defensible boundary is the input, not the model.**

## How I judge a bypass as "practical"

A bypass is practical if it (a) produces an attacker-chosen result, (b) survives
the integrity checks the product actually ships, and (c) is repeatable rather than
a one-off. Technique 1 fails (b). Technique 2 passes (b) but a calibration-anomaly
detector reaches it. Technique 3 passes all three against a client that only
guards the model and the output — which is the common case.

## What would change on a hardened target

Everything above works against a minified but readable-by-name bundle. On a
**property-mangled, control-flow-obfuscated, or WASM** staging build (plain
minification, as shown above, is not enough to stop it), Stage 1 becomes the hard
part and the honest change of method is:

- Work from the runtime, not the source: set breakpoints on `getUserMedia`, the
  TF.js inference call, and `canvas`/`getImageData` to find the sensor→feature and
  feature→model boundaries by observation.
- Recover the shipped model by capturing its network load or dumping the TF.js
  model object from the heap, rather than reading a `model.json` path.
- For WASM, inspect the module's imports/exports and memory rather than JS
  identifiers.

The extraction and tamper *techniques* (Stages 2–3) are unchanged; only the
*locating* work in Stage 1 gets harder. Being explicit: paid adversarial RE of a
hardened bundle is the part I would be doing on the engagement itself, not
something this sample claims to have already done.

## Recommendations

For any "the camera never leaves the device" product, the truths worth stating
plainly:

1. **Client-side integrity is a cost problem, not a wall.** On-device means the
   attacker owns the runtime; every measure raises attacker effort rather than
   preventing tampering. A product that believes otherwise is the one that gets
   burned.
2. **Guard the input, not just the model.** Techniques 2 and 3 leave the model and
   its output untouched. Liveness / real-sensor signals (that the pixels came from
   a genuine camera and a genuine face, not an injected buffer) are the boundary
   that actually bites; model checksums and output-range checks do not reach them.
3. **Move the trust decision server-side where the stakes require it.** If a
   result gates something valuable, the device can produce evidence but should not
   be the thing that adjudicates. Prefer server-side attestation of the result,
   signed model loading, and *detecting* tamper server-side over *preventing* it
   client-side.
4. **Treat obfuscation and anti-debug as speed bumps with honest expiry dates.**
   They raise Stage-1 cost, buy time, and are worth doing — but budgeting for them
   as a wall is the mistake.

## Reproduce

```
# from the repo root
python3 -m http.server 8891
# open http://localhost:8891/poc/index.html

# headless correctness check of the extracted-model math:
node poc/verify.node.js
```

The page loads the genuine WebGazer bundle from a CDN and runs Stages 1–3 with no
webcam; the Node check confirms the standalone regression math independently.
