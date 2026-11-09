import { yieldTurn } from "safe-bash-contracts/yield";
import type { MediaBudgetTracker } from "@poe-code/mp4-ast";

import { parseFilterExpression } from "./filter-expression.js";
import { transform } from "./audio-fft.js";

export async function enhanceDialogue(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number,
  original: number, enhance: number, voice: number,
  budget: MediaBudgetTracker, signal?: AbortSignal,
  commands: readonly { sample: number; expression: string }[] = []
): Promise<{ channels: Float32Array[]; frameSize: number }> {
  if (channels.length !== 2) throw new Error("dialoguenhance: stereo input required");
  const size = sampleRate > 100000 ? 8192 : sampleRate > 50000 ? 4096 : 2048;
  const hop = size / 4, delay = size - hop, length = channels[0]!.length;
  budget.allocateMemory(3 * length * 4 + size * 8 * 12);
  const output = Array.from({ length: 3 }, () => new Float32Array(length));
  const window = Float32Array.from({ length: size }, (_, i) => Math.sin(Math.fround(Math.PI * i / (size - 1))));
  const input = [new Float64Array(size), new Float64Array(size)];
  const real = [new Float64Array(size), new Float64Array(size)];
  const imaginary = [new Float64Array(size), new Float64Array(size)];
  const cr = new Float64Array(size), ci = new Float64Array(size);
  const previousCenter = new Float64Array(size / 2 + 1), previousDifference = new Float64Array(size / 2 + 1);
  const overlap = new Float32Array(size);
  let vad = 0;
  let nextCommand = 0;
  for (let start = 0; start < length; start += hop) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    while (nextCommand < commands.length && commands[nextCommand]!.sample <= start) {
      const command = commands[nextCommand++]!;
      try {
        const value = parseFilterExpression(command.expression, "dialoguenhance", {});
        if (Number.isFinite(value) && value >= 0 && value <= 1) original = Math.fround(value);
      } catch { /* Native asendcmd continues after a rejected command. */ }
    }
    const count = Math.min(hop, length - start);
    overlap.copyWithin(0, hop); overlap.fill(0, delay);
    for (let c = 0; c < 2; c++) {
      input[c]!.copyWithin(0, hop);
      input[c]!.set(channels[c]!.subarray(start, start + count), delay);
      imaginary[c]!.fill(0);
      for (let i = 0; i < size; i++) real[c]![i] = Math.fround(input[c]![i]! * window[i]!);
      transform(real[c]!, imaginary[c]!);
      output[c]!.set(input[c]!.subarray(0, count), start);
    }
    let centerFlux = 0, differenceFlux = 0;
    for (let i = 0; i <= size / 2; i++) {
      const sr = real[0]![i]! + real[1]![i]!, si = imaginary[0]![i]! + imaginary[1]![i]!;
      const dr = real[0]![i]! - real[1]![i]!, di = imaginary[0]![i]! - imaginary[1]![i]!;
      const a = 0.5 * (1 - Math.sqrt((dr * dr + di * di) / (sr * sr + si * si + 2 ** -23)));
      cr[i] = a * sr; ci[i] = a * si;
      const center = Math.hypot(cr[i]!, ci[i]!), difference = Math.hypot(dr, di);
      centerFlux += (center - previousCenter[i]!) ** 2;
      differenceFlux += (difference - previousDifference[i]!) ** 2;
      // Native retains the previous transform except for its Nyquist bin.
      if (i < size / 2) { previousCenter[i] = center; previousDifference[i] = difference; }
    }
    const detected = centerFlux + differenceFlux === 0 ? 0 : Math.max(0, Math.min(1, voice * (centerFlux / (centerFlux + differenceFlux) - 0.5)));
    vad = Math.fround(0.1 * detected + 0.9 * vad);
    for (let i = 0; i <= size / 2; i++) {
      const power = cr[i]! ** 2 + ci[i]! ** 2;
      const difference = (real[0]![i]! - real[1]![i]!) ** 2 + (imaginary[0]![i]! - imaginary[1]![i]!) ** 2;
      const gain = original + vad * power / (power + difference + 2 ** -23) * enhance;
      cr[i] = cr[i]! * gain; ci[i] = ci[i]! * gain;
      if (i > 0 && i < size / 2) { cr[size - i] = cr[i]!; ci[size - i] = -ci[i]!; }
    }
    transform(cr, ci, true);
    for (let i = 0; i < size; i++) overlap[i] = overlap[i]! + Math.fround(cr[i]! / (size * 1.5)) * window[i]!;
    output[2]!.set(overlap.subarray(0, count), start);
  }
  return { channels: output, frameSize: hop };
}
