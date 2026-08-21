/*
 * demo.js — drives WebGazer's real regression object through the three stages of
 * the assessment: reverse-engineer -> extract -> tamper.
 *
 * It runs without a webcam. Instead of collecting calibration from live clicks,
 * it seeds WebGazer's genuine RidgeReg instance with a deterministic synthetic
 * calibration set, so the whole run is reproducible by anyone who opens the page.
 * Every operation below is performed against the unmodified library object that
 * ships in webgazer.min.js — the synthetic data only stands in for the user's
 * clicks; the extraction and tamper code is exactly what would run against a live
 * session.
 */

(function () {
  const out = document.getElementById("log");
  function log(msg, cls) {
    const line = document.createElement("div");
    if (cls) line.className = cls;
    line.textContent = msg;
    out.appendChild(line);
  }
  function h(msg) { log(""); log(msg, "h"); }
  function ok(msg) { log(msg, "ok"); }
  function warn(msg) { log(msg, "warn"); }
  const r2 = (n) => Math.round(n * 100) / 100;

  // ---- deterministic synthetic calibration -------------------------------
  // D features per sample (stands in for WebGazer's concatenated eye-patch
  // histograms), N samples (stands in for an N-point calibration).
  const D = 6, N = 9;
  // A fixed "true" gaze mapping we invent so the numbers are meaningful; the
  // client's real coefficients would be whatever the user's eyes produced.
  const trueCoefX = [220, -60, 15, 90, -25, 400];
  const trueCoefY = [-80, 300, 40, -20, 120, 250];
  // Seeded PRNG so the page is byte-for-byte reproducible.
  let seed = 1337;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const calib = [];
  for (let i = 0; i < N; i++) {
    const f = Array.from({ length: D }, () => r2(rnd()));
    const sx = Math.floor(f.reduce((s, v, j) => s + v * trueCoefX[j], 0));
    const sy = Math.floor(f.reduce((s, v, j) => s + v * trueCoefY[j], 0));
    calib.push({ features: f, screenX: sx, screenY: sy });
  }
  // A query gaze the "user" is currently making — the point we later forge.
  const queryFeatures = Array.from({ length: D }, () => r2(rnd()));

  function seedRegression() {
    const reg = new webgazer.reg.RidgeReg(); // the genuine library object
    for (const c of calib) {
      reg.eyeFeaturesClicks.push(c.features);
      // WebGazer stores each screen coordinate as a 1-element column vector
      // (addData pushes [screenPos[0]]); match that shape exactly.
      reg.screenXClicksArray.push([c.screenX]);
      reg.screenYClicksArray.push([c.screenY]);
    }
    return reg;
  }

  // Ask WebGazer's OWN predict() for a point, by substituting the eye-feature
  // extractor (which normally reads webcam pixels) with a chosen vector. This is
  // the honest way to query the real model on a known input without a camera.
  function webgazerPredict(reg, features) {
    const original = webgazer.util.getEyeFeats;
    webgazer.util.getEyeFeats = () => features;
    try { return reg.predict({ __synthetic: true }); }
    finally { webgazer.util.getEyeFeats = original; }
  }

  function run() {
    webgazer.params.applyKalmanFilter = false; // deterministic, no smoothing

    log("WebGazer loaded from CDN. version/keys visible on the client:");
    log("  webgazer.reg.RidgeReg   -> " + typeof webgazer.reg.RidgeReg);
    log("  webgazer.tracker.TFFaceMesh -> " + typeof webgazer.tracker.TFFaceMesh);
    log("  webgazer.util.getEyeFeats   -> " + typeof webgazer.util.getEyeFeats);

    // ---- STAGE 1: reverse-engineer / locate the model --------------------
    h("STAGE 1 — locate the model inside the running client");
    const reg = seedRegression();
    log("The gaze model is a two-stage pipeline:");
    log("  (a) MediaPipe FaceMesh (TF.js) -> 468 face landmarks -> eye patches");
    log("  (b) ridge regression -> maps eye-patch features to screen (x,y)");
    log("Stage (b) is the product-specific model. It is NOT shipped as a weights");
    log("file: it is rebuilt in the browser from the user's calibration clicks and");
    log("lives in memory on the RidgeReg instance. Evidence we are inside it:");
    log("  ridgeParameter (k)       = " + reg.ridgeParameter);
    log("  calibration samples held = " + reg.eyeFeaturesClicks.length);
    log("  feature vector length    = " + reg.eyeFeaturesClicks.data[0].length);

    // ---- STAGE 2: extract + run locally ----------------------------------
    h("STAGE 2 — extract the model and run it outside WebGazer");
    const extracted = {
      ridgeParameter: reg.ridgeParameter,
      features: reg.eyeFeaturesClicks.data.map((v) => v.slice()),
      // Stored as [[x],[y],...]; flatten to plain numbers for the standalone model.
      screenX: reg.screenXClicksArray.data.map((v) => v[0]),
      screenY: reg.screenYClicksArray.data.map((v) => v[0]),
    };
    log("Pulled the full calibration training set straight out of the live object:");
    log("  " + JSON.stringify({
      ridgeParameter: extracted.ridgeParameter,
      samples: extracted.features.length,
      featureDim: extracted.features[0].length,
    }));
    log("(In a real session this same array holds the user's actual eye features.)");

    const model = Ridge.ExtractedGazeModel(extracted); // standalone, no WebGazer
    let matches = 0;
    log("Reproducing every calibration point with the standalone re-implementation:");
    for (const c of calib) {
      const mine = model.predict(c.features);
      const theirs = webgazerPredict(reg, c.features);
      const same = mine.x === theirs.x && mine.y === theirs.y;
      if (same) matches++;
    }
    const q = { mine: model.predict(queryFeatures), theirs: webgazerPredict(reg, queryFeatures) };
    log("  live query -> WebGazer says " + JSON.stringify(q.theirs) +
        " ; extracted model says " + JSON.stringify(q.mine));
    if (matches === calib.length && q.mine.x === q.theirs.x && q.mine.y === q.theirs.y)
      ok("EXTRACTION CONFIRMED: standalone model reproduces WebGazer exactly (" +
         matches + "/" + calib.length + " calibration points + live query).");
    else
      warn("Mismatch — see values above.");

    // ---- STAGE 3: tamper with the result ---------------------------------
    h("STAGE 3 — forge the gaze result (three techniques, weakest to strongest)");
    const TARGET = { x: 1234, y: 567 };
    log("Goal: make the client report the user is looking at (" +
        TARGET.x + ", " + TARGET.y + ") while they are not.");

    // Technique 1 — output patch. Overwrite predict() to return a constant.
    log("");
    log("[1] Output patch — overwrite predict() on the instance:");
    const reg1 = seedRegression();
    reg1.predict = () => ({ x: TARGET.x, y: TARGET.y });
    log("    predict(anything) -> " + JSON.stringify(reg1.predict()));
    warn("    Works, but crude: any integrity check on predict's source defeats it.");

    // Technique 2 — calibration poisoning. Model + predict() untouched; we add
    // crafted calibration points so the REAL ridge math outputs the target.
    log("");
    log("[2] Calibration poisoning — feed crafted training points, model unmodified:");
    const reg2 = seedRegression();
    for (let i = 0; i < 60; i++) {           // outvote the honest points
      reg2.eyeFeaturesClicks.push(queryFeatures.slice());
      reg2.screenXClicksArray.push([TARGET.x]);
      reg2.screenYClicksArray.push([TARGET.y]);
    }
    const poisoned = webgazerPredict(reg2, queryFeatures);
    log("    honest predict(query) was " + JSON.stringify(q.theirs) +
        " ; after poisoning -> " + JSON.stringify(poisoned));
    warn("    Survives output-integrity checks: predict() is byte-for-byte original;");
    warn("    the model genuinely computes the attacker's answer.");

    // Technique 3 — input forgery. Model, data AND predict() all untouched; we
    // craft the eye-feature vector that the honest model maps to the target.
    log("");
    log("[3] Input forgery — craft eye features the honest model maps to target:");
    const reg3 = seedRegression();
    // Least-norm solution of [coefX; coefY] . qStar = [TARGET.x, TARGET.y].
    const A = [model.coefX, model.coefY];               // 2 x D
    const At = Ridge.transpose(A);                       // D x 2
    const AAt = Ridge.matMul(A, At);                     // 2 x 2
    const t = [[TARGET.x], [TARGET.y]];
    const lambda = Ridge.solve(AAt, t);                 // 2
    const qStar = At.map((row) => row[0] * lambda[0] + row[1] * lambda[1]);
    const forged = webgazerPredict(reg3, qStar);
    log("    forged feature vector -> " + JSON.stringify(qStar.map(r2)));
    log("    honest predict(forged features) -> " + JSON.stringify(forged));
    warn("    Strongest: model, calibration data and predict() are all untouched.");
    warn("    Every internal value is self-consistent, so it is the hardest to spot.");

    h("Done. See REPORT.md for what this means and how a defender should respond.");
  }

  // Wait for the CDN bundle to define the global.
  (function waitFor() {
    if (window.webgazer && webgazer.reg && webgazer.reg.RidgeReg) {
      try { run(); } catch (e) { warn("Error: " + e.message); console.error(e); }
    } else {
      setTimeout(waitFor, 100);
    }
  })();
})();
