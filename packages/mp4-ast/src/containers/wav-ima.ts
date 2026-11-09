import type { MediaBudgetTracker } from "../types.js";

// IMA/DVI ADPCM uses one predictor/index header per channel, then groups of
// four bytes per channel. Each byte stores the earlier sample in its low nibble.
export const steps = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
  34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544,
  598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707,
  1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871,
  5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635,
  13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];
export const indexChanges = [-1, -1, -1, -1, 2, 4, 6, 8];

export function imaBlockFrames(size: number, channels: number): number {
  if (size < channels * 4 || (size - channels * 4) % (channels * 4) !== 0)
    throw new Error("Invalid IMA WAV block size");
  return 1 + (size - channels * 4) * 2 / channels;
}

export function decodeImaWav(data: Uint8Array, channels: number, blockAlign: number, frames: number): Float32Array[] {
  const output = Array.from({ length: channels }, () => new Float32Array(frames));
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let frame = 0;
  blocks: for (let offset = 0; offset < data.length; offset += blockAlign) {
    // Only complete channel groups contribute samples; a short header contributes none.
    const size = Math.floor(Math.min(blockAlign, data.length - offset) / (channels * 4)) * channels * 4;
    if (size === 0) continue;
    const count = imaBlockFrames(size, channels);
    // A damaged channel invalidates the whole block, including its other channels.
    for (let ch = 0; ch < channels; ch++) {
      if (view.getUint16(offset + ch * 4 + 2, true) > 88) continue blocks;
    }
    for (let ch = 0; ch < channels; ch++) {
      let predictor = view.getInt16(offset + ch * 4, true);
      let index = view.getUint16(offset + ch * 4 + 2, true);
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
  if (data.length >= channels * 4 && frame === 0) throw new Error("Invalid IMA WAV step index");
  return frame === frames ? output : output.map(samples => samples.subarray(0, frame));
}

export function encodeImaWav(channelData: readonly (Float32Array | Float64Array)[], blockAlign: number, trellis = 0, budget?: MediaBudgetTracker): Uint8Array {
  if (!Number.isInteger(trellis) || trellis < 0 || trellis > 16) throw new Error("Invalid trellis: expected an integer from 0 to 16");
  const channels = channelData.length;
  if (channels < 1 || channels > 2) throw new Error("IMA WAV encoding supports mono or stereo audio");
  const frames = imaBlockFrames(blockAlign, channels);
  const count = channelData[0]!.length;
  const output = new Uint8Array(Math.ceil(count / frames) * blockAlign);
  const view = new DataView(output.buffer);
  const indices = new Uint8Array(channels);
  for (let offset = 0, frame = 0; offset < output.length; offset += blockAlign, frame += frames) {
    for (let ch = 0; ch < channels; ch++) {
      const samples = channelData[ch]!;
      let predictor = Math.max(-32768, Math.min(32767, Math.round((samples[frame] ?? 0) * 32768)));
      let index = indices[ch]!;
      view.setInt16(offset + ch * 4, predictor, true);
      output[offset + ch * 4 + 2] = index;
      if (trellis > 0) {
        const encoded = encodeTrellis(samples, frame + 1, frames - 1, predictor, index, trellis, budget);
        for (let i = 0; i < encoded.nibbles.length; i += 2) {
          const position = offset + channels * 4 + Math.floor(i / 8) * channels * 4 + ch * 4 + (i % 8) / 2;
          output[position] = encoded.nibbles[i]! | (encoded.nibbles[i + 1]! << 4);
        }
        indices[ch] = encoded.index;
        continue;
      }
      let sample = frame + 1;
      for (let group = offset + channels * 4; group < offset + blockAlign; group += channels * 4) {
        for (let byte = 0; byte < 4; byte++) {
          let value = 0;
          for (let shift = 0; shift < 8; shift += 4) {
            const target = Math.max(-32768, Math.min(32767, Math.round((samples[sample++] ?? 0) * 32768)));
            const difference = target - predictor;
            const step = steps[index]!;
            // FFmpeg quantizes before rounding the reconstructed difference.
            // Subtracting truncated step fractions overstates small changes.
            const magnitude = Math.min(7, Math.floor(Math.abs(difference) * 4 / step));
            const nibble = magnitude | (difference < 0 ? 8 : 0);
            const delta = ((2 * magnitude + 1) * step) >>> 3;
            predictor = Math.max(-32768, Math.min(32767, predictor + ((nibble & 8) ? -delta : delta)));
            index = Math.max(0, Math.min(88, index + indexChanges[nibble & 7]!));
            value |= nibble << shift;
          }
          output[group + ch * 4 + byte] = value;
        }
      }
      indices[ch] = index;
    }
  }
  return output;
}

// Match FFmpeg's heap ordering and predictor deduplication, including ties.
// Freeze the best path every 128 samples to bound search history.
function encodeTrellis(samples: Float32Array | Float64Array, start: number, count: number,
  predictor: number, index: number, depth: number, budget?: MediaBudgetTracker): { nibbles: Uint8Array; index: number } {
  const frontier = 1 << depth;
  const memory = frontier * (128 * 5 + 128) + 65536 + count;
  budget?.allocateMemory(memory);
  try {
    const previous = new Uint32Array(frontier * 128);
    const codes = new Uint8Array(frontier * 128);
    const seen = new Uint8Array(65536).fill(255);
    const nibbles = new Uint8Array(count);
    type Node = { error: number; predictor: number; index: number; path: number };
    let nodes: Node[] = [{ error: 0, predictor, index, path: 0 }];
    let pathCount = 0, frozen = -1, generation = 0;
    for (let i = 0; i < count; i++) {
      budget?.checkCpu();
      const target = Math.max(-32768, Math.min(32767, Math.round((samples[start + i] ?? 0) * 32768)));
      const next: Node[] = [];
      let heapPosition = 0;
      for (let j = 0; j < nodes.length; j++) {
        const node = nodes[j]!;
        const range = j < frontier / 2 ? 1 : 0;
        const step = steps[node.index]!;
        const div = Math.trunc((target - node.predictor) * 4 / step);
        let min = Math.max(-7, Math.min(6, div - range));
        let max = Math.max(-6, Math.min(7, div + range));
        if (min <= 0) min--;
        if (max < 0) max--;
        for (let candidate = min; candidate <= max; candidate++) {
          const nibble = candidate < 0 ? 7 - candidate : candidate;
          const delta = Math.trunc(step * (2 * (nibble & 7) + 1) * (nibble & 8 ? -1 : 1) / 8);
          const value = Math.max(-32768, Math.min(32767, node.predictor + delta));
          const error = (node.error + (target - value) ** 2) >>> 0;
          if (error < node.error || seen[value & 65535] === generation) continue;
          let position: number;
          if (heapPosition < frontier) position = heapPosition++;
          else {
            position = (frontier >> 1) + (heapPosition & ((frontier >> 1) - 1));
            if (error > next[position]!.error) continue;
            heapPosition++;
          }
          seen[value & 65535] = generation;
          const path = next[position]?.path ?? pathCount++;
          next[position] = { error, predictor: value,
            index: Math.max(0, Math.min(88, node.index + indexChanges[nibble & 7]!)), path };
          codes[path] = nibble;
          previous[path] = node.path;
          while (position > 0) {
            const parent = (position - 1) >> 1;
            if (next[parent]!.error <= error) break;
            [next[parent], next[position]] = [next[position]!, next[parent]!];
            position = parent;
          }
        }
      }
      nodes = next;
      if (++generation === 255) { seen.fill(255); generation = 0; }
      const best = nodes[0]!;
      if (best.error > 1 << 28) {
        for (let j = 1; j < nodes.length; j++) nodes[j]!.error -= best.error;
        best.error = 0;
      }
      if (i === frozen + 128 || i === count - 1) {
        let path = best.path;
        for (let k = i; k > frozen; k--) {
          nibbles[k] = codes[path]!;
          path = previous[path]!;
        }
        frozen = i;
        pathCount = 0;
        nodes.length = 1;
      }
    }
    return { nibbles, index: nodes[0]!.index };
  } finally {
    budget?.releaseMemory(memory);
  }
}
