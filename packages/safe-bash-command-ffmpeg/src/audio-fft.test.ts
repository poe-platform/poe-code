import assert from "node:assert/strict";
import { it } from "node:test";
import { transform } from "./audio-fft.js";

for (const size of [12, 20, 28, 36, 1028, 1536]) {
  it(`transforms ${size} complex samples and reuses scratch for the inverse`, () => {
    const real = Float64Array.from({ length: size }, (_, i) => Math.sin(i * 0.31));
    const imaginary = Float64Array.from({ length: size }, (_, i) => Math.cos(i * 0.27));
    const originalReal = real.slice(), originalImaginary = imaginary.slice();
    const workspace = new Float64Array(4 * 2 ** Math.ceil(Math.log2(2 * size - 1)));
    transform(real, imaginary, false, workspace);
    // Compare independent DFT bins, including DC, Nyquist and negative frequencies.
    for (const k of [0, 1, size / 2, size - 1]) {
      let expectedReal = 0, expectedImaginary = 0;
      for (let i = 0; i < size; i++) {
        const angle = -2 * Math.PI * k * i / size;
        expectedReal += originalReal[i]! * Math.cos(angle) - originalImaginary[i]! * Math.sin(angle);
        expectedImaginary += originalReal[i]! * Math.sin(angle) + originalImaginary[i]! * Math.cos(angle);
      }
      assert.ok(Math.abs(real[k]! - expectedReal) < 1e-8, `real bin ${k}`);
      assert.ok(Math.abs(imaginary[k]! - expectedImaginary) < 1e-8, `imaginary bin ${k}`);
    }
    transform(real, imaginary, true, workspace);
    for (let i = 0; i < size; i++) {
      assert.ok(Math.abs(real[i]! / size - originalReal[i]!) < 1e-10, `real sample ${i}`);
      assert.ok(Math.abs(imaginary[i]! / size - originalImaginary[i]!) < 1e-10, `imaginary sample ${i}`);
    }
  });
}
