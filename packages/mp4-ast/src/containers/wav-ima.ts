// IMA/DVI ADPCM uses one predictor/index header per channel, then groups of
// four bytes per channel. Each byte stores the earlier sample in its low nibble.
const steps = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
  34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544,
  598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707,
  1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871,
  5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635,
  13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];
const indexChanges = [-1, -1, -1, -1, 2, 4, 6, 8];

export function imaBlockFrames(size: number, channels: number): number {
  if (size < channels * 4 || (size - channels * 4) % (channels * 4) !== 0)
    throw new Error("Invalid IMA WAV block size");
  return 1 + (size - channels * 4) * 2 / channels;
}

export function decodeImaWav(data: Uint8Array, channels: number, blockAlign: number, frames: number): Float32Array[] {
  const output = Array.from({ length: channels }, () => new Float32Array(frames));
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let frame = 0;
  for (let offset = 0; offset < data.length; offset += blockAlign) {
    const size = Math.min(blockAlign, data.length - offset);
    const count = imaBlockFrames(size, channels);
    for (let ch = 0; ch < channels; ch++) {
      let predictor = view.getInt16(offset + ch * 4, true);
      let index = data[offset + ch * 4 + 2]!;
      if (index > 88) throw new Error("Invalid IMA WAV step index");
      const samples = output[ch]!;
      samples[frame] = predictor / 32768;
      let sample = frame + 1;
      for (let group = offset + channels * 4; group < offset + size; group += channels * 4) {
        for (let byte = 0; byte < 4; byte++) {
          const value = data[group + ch * 4 + byte]!;
          for (const nibble of [value & 15, value >>> 4]) {
            const step = steps[index]!;
            const delta = (step >>> 3) + ((nibble & 1) ? step >>> 2 : 0)
              + ((nibble & 2) ? step >>> 1 : 0) + ((nibble & 4) ? step : 0);
            predictor = Math.max(-32768, Math.min(32767, predictor + ((nibble & 8) ? -delta : delta)));
            index = Math.max(0, Math.min(88, index + indexChanges[nibble & 7]!));
            samples[sample++] = predictor / 32768;
          }
        }
      }
    }
    frame += count;
  }
  return output;
}
