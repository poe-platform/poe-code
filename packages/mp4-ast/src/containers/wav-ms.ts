// Microsoft ADPCM predictors and adaptive quantizer multipliers.
const coefficients = [[256, 0], [512, -256], [0, 0], [192, 64], [240, 0], [460, -208], [392, -232]] as const;
const adaptation = [230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230];

export function msBlockFrames(size: number, channels: number): number {
  if (channels !== 1 && channels !== 2) throw new Error("MS ADPCM WAV requires mono or stereo audio");
  if (size < channels * 7) throw new Error("Invalid MS ADPCM WAV block size");
  return 2 + (size - channels * 7) * 2 / channels;
}

export function decodeMsWav(data: Uint8Array, channels: number, blockAlign: number, frames: number): Float32Array[] {
  const output = Array.from({ length: channels }, () => new Float32Array(frames));
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let frame = 0;
  for (let offset = 0; offset < data.length; offset += blockAlign) {
    const size = Math.min(blockAlign, data.length - offset);
    const count = msBlockFrames(size, channels);
    for (let ch = 0; ch < channels; ch++) {
      const coefficient = coefficients[data[offset + ch]!];
      if (!coefficient) throw new Error("Invalid MS ADPCM WAV predictor");
      let delta = view.getUint16(offset + channels + ch * 2, true);
      let recent = view.getInt16(offset + channels * 3 + ch * 2, true);
      let previous = view.getInt16(offset + channels * 5 + ch * 2, true);
      const samples = output[ch]!;
      samples[frame] = previous / 32768;
      samples[frame + 1] = recent / 32768;
      for (let i = 2; i < count; i++) {
        const nibbleIndex = (i - 2) * channels + ch;
        const byte = data[offset + channels * 7 + (nibbleIndex >>> 1)]!;
        const nibble = (nibbleIndex & 1) ? byte & 15 : byte >>> 4;
        const predicted = Math.trunc((recent * coefficient[0] + previous * coefficient[1]) / 256)
          + (nibble < 8 ? nibble : nibble - 16) * delta;
        previous = recent;
        recent = Math.max(-32768, Math.min(32767, predicted));
        delta = Math.max(16, Math.floor(delta * adaptation[nibble]! / 256));
        samples[frame + i] = recent / 32768;
      }
    }
    frame += count;
  }
  return output;
}
