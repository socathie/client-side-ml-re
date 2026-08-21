(module
  ;; --- an age-estimation model compiled to WebAssembly ---
  ;; Linear model: age = w0*f0 + w1*f1 + w2*f2 + w3*f3 + bias.
  ;; The learned parameters live in a data segment (bytes 0..39 of linear
  ;; memory): five little-endian f64 = [w0,w1,w2,w3,bias]. This is exactly the
  ;; surface a shipped WASM model presents to reverse engineering.
  (memory (export "memory") 1)
  (data (i32.const 0) "\9a\99\99\99\99\99\e9\3f\00\00\00\00\00\00\f8\3f\33\33\33\33\33\33\d3\bf\cd\cc\cc\cc\cc\cc\00\40\00\00\00\00\00\00\32\40")
  (func (export "predict") (param $f0 f64) (param $f1 f64) (param $f2 f64) (param $f3 f64) (result f64)
    (f64.add
      (f64.add
        (f64.add
          (f64.mul (local.get $f0) (f64.load (i32.const 0)))
          (f64.mul (local.get $f1) (f64.load (i32.const 8))))
        (f64.add
          (f64.mul (local.get $f2) (f64.load (i32.const 16)))
          (f64.mul (local.get $f3) (f64.load (i32.const 24)))))
      (f64.load (i32.const 32)))))
