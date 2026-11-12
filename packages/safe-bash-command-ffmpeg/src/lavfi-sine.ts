// FFmpeg's sine source uses 15-bit table indices and signed PCM16 samples.
// Refine a quarter-circle with integer midpoints at three extra amplitude bits;
// quantizing Math.sin directly produces a different waveform.
export const sineTable = (() => {
  const quarter = 8192;
  const amplitude = 4095 * 8;
  const table = new Int16Array(quarter * 4);
  table[quarter] = amplitude;
  for (let step = quarter; step > 1; step /= 2) {
    for (let i = 0; i < quarter / 2; i += step) {
      const sine = table[i]! + table[i + step]!;
      const cosine = table[quarter - i]! + table[quarter - i - step]!;
      const scale = Math.round(amplitude * 65536 / Math.sqrt(sine * sine + cosine * cosine));
      // Complementary midpoints use opposite tie directions.
      table[i + step / 2] = Math.floor((sine * scale + 32767) / 65536);
      table[quarter - i - step / 2] = Math.floor((cosine * scale + 32768) / 65536);
    }
  }
  for (let i = 0; i <= quarter; i++) table[i] = (table[i]! + 4) >> 3;
  for (let i = 0; i < quarter; i++) table[quarter * 2 - i] = table[i]!;
  for (let i = 0; i < quarter * 2; i++) table[i + quarter * 2] = -table[i]!;
  return table;
})();
