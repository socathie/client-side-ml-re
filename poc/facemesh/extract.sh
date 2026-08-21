#!/usr/bin/env bash
# extract.sh — pull WebGazer's shipped face-landmark model straight out of the
# endpoint baked into webgazer.min.js, and enumerate it.
#
# The bundle hardcodes this tfhub URL (grep the min bundle for "face_mesh"):
#   https://tfhub.dev/mediapipe/tfjs-model/face_landmarks_detection/face_mesh/1
# tfhub 302-redirects to signed Google Cloud Storage URLs; ?tfjs-format=file
# gives the raw TF.js graph-model files. No auth, no WebGazer needed.
set -euo pipefail
BASE="https://tfhub.dev/mediapipe/tfjs-model/face_landmarks_detection/face_mesh/1"
OUT="$(dirname "$0")/model"
mkdir -p "$OUT"

echo "Fetching model.json ..."
curl -sSL "$BASE/model.json?tfjs-format=file" -o "$OUT/model.json"

# Read the weight shard names out of the manifest and fetch them.
python3 - "$OUT" "$BASE" <<'PY'
import json, sys, urllib.request, os
out, base = sys.argv[1], sys.argv[2]
m = json.load(open(os.path.join(out, "model.json")))
shards, tensors, params = [], 0, 0
for g in m.get("weightsManifest", []):
    shards += g.get("paths", [])
    for w in g.get("weights", []):
        tensors += 1
        p = 1
        for d in w.get("shape", []): p *= d if d > 0 else 1
        params += p
for s in shards:
    data = urllib.request.urlopen(base + "/" + s + "?tfjs-format=file", timeout=60).read()
    open(os.path.join(out, s), "wb").write(data)
    print(f"  {s}: {len(data):,} bytes")
sig = m.get("signature", {})
print("\nExtracted a real TF.js graph model:")
print("  parameters :", f"{params:,}")
print("  tensors    :", tensors)
print("  inputs     :", {k: [d.get('size') for d in v['tensorShape']['dim']] for k, v in sig.get('inputs', {}).items()})
print("  outputs    :", {k: [d.get('size') for d in v['tensorShape']['dim']] for k, v in sig.get('outputs', {}).items()})
PY
echo
echo "Done. Open run.html to load and run the extracted model outside WebGazer."
