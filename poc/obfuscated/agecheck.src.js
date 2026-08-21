/*
 * agecheck.src.js — the clean "before" model, for reference only.
 *
 * A tiny on-device age estimator: age = round(bias + Σ features[i]·weights[i]).
 * obfuscate.js turns THIS into agecheck.obf.js (weights hidden in an XOR+base64
 * blob, formula assembled via new Function, identifiers mangled). The RE exercise
 * is to recover this model from that obfuscated bundle without reading this file.
 */
(function (root) {
  var WEIGHTS = [0.8, 1.5, -0.3, 2.1];
  var BIAS = 18.0;
  function estimateAge(features) {
    var age = BIAS;
    for (var i = 0; i < features.length; i++) age += features[i] * WEIGHTS[i];
    return Math.round(age);
  }
  root.estimateAge = estimateAge;
})(typeof module !== "undefined" ? module.exports : (self.AgeCheck = {}));
