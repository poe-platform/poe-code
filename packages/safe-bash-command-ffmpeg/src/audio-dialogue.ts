import { yieldTurn } from "safe-bash-contracts/yield";
import type { MediaBudgetTracker } from "@poe-code/mp4-ast";

import { parseFilterExpression } from "./filter-expression.js";
import { transform } from "./audio-fft.js";
import doubleTables from "./audio-dialogue-double-tables.json" with { type: "json" };
import { dialogueDoubleTransform } from "./audio-dialogue-double-fft.js";
import { dialogueSpectrum } from "./audio-dialogue-fft.js";

export async function enhanceDialogue(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number,
  original: number, enhance: number, voice: number,
  budget: MediaBudgetTracker, signal?: AbortSignal,
  commands: readonly { sample: number; expression: string }[] = [],
  double = false
): Promise<{ channels: (Float32Array | Float64Array)[]; frameSize: number }> {
  if (channels.length !== 2) throw new Error("dialoguenhance: stereo input required");
  const size = sampleRate > 100000 ? 8192 : sampleRate > 50000 ? 4096 : 2048;
  const hop = size / 4, delay = size - hop, length = channels[0]!.length;
  const SampleArray = double ? Float64Array : Float32Array;
  const round = double ? (value: number) => value : Math.fround;
  const epsilon = double ? Number.EPSILON : 2 ** -23;
  budget.allocateMemory(3 * length * SampleArray.BYTES_PER_ELEMENT + size * 8 * (double ? 20 : 12));
  const output = Array.from({ length: 3 }, () => new SampleArray(length));
  // Little-endian binary64 analysis constants from FFmpeg 7's glibc 2.28:
  // sin(PI*i/(size-1)), cos(i*(2*PI/8192)). Math.sin/cos vary by runtime.
  const window = double ? new Float64Array(size) : Float32Array.from({ length: size }, (_, i) => Math.sin(Math.fround(Math.PI * i / (size - 1))));
  const doubleCosine = double ? new Float64Array(size / 4 + 1) : undefined;
  if (double) {
    const windowBytes = Uint8Array.from(atob(doubleTables[size]), character => character.charCodeAt(0));
    const cosineBytes = Uint8Array.from(atob(doubleTables.cosine), character => character.charCodeAt(0));
    const windowData = new DataView(windowBytes.buffer), cosineData = new DataView(cosineBytes.buffer);
    for (let i = 0; i < size; i++) window[i] = windowData.getFloat64(i * 8, true);
    for (let i = 0; i <= size / 4; i++) doubleCosine![i] = cosineData.getFloat64(i * (8192 / size) * 8, true);
  }
  const cosine = double ? undefined : Float32Array.from({ length: size / 4 + 1 }, (_, i) => i === size / 4 ? 0 : Math.cos(2 * Math.PI * i / size));
  const input = [new Float64Array(size), new Float64Array(size)];
  const real = [new Float64Array(size), new Float64Array(size)];
  const imaginary = [new Float64Array(size), new Float64Array(size)];
  const cr = new Float64Array(size), ci = new Float64Array(size);
  const previousCenter = new Float64Array(size / 2 + 1), previousDifference = new Float64Array(size / 2 + 1);
  const overlap = new SampleArray(size);
  const packed = double ? new Float64Array(size) : undefined;
  const scratch = double ? new Float64Array(size) : undefined;
  let vad = 0;
  let nextCommand = 0;
  for (let start = 0; start < length; start += hop) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    while (nextCommand < commands.length && commands[nextCommand]!.sample <= start) {
      const command = commands[nextCommand++]!;
      try {
        const value = parseFilterExpression(command.expression, "dialoguenhance", {});
        if (Number.isFinite(value) && value >= 0 && value <= 1) original = round(value);
      } catch { /* Native asendcmd continues after a rejected command. */ }
    }
    const count = Math.min(hop, length - start);
    overlap.copyWithin(0, hop); overlap.fill(0, delay);
    for (let c = 0; c < 2; c++) {
      input[c]!.copyWithin(0, hop);
      input[c]!.set(channels[c]!.subarray(start, start + count), delay);
      for (let i = 0; i < size; i++) real[c]![i] = round(input[c]![i]! * window[i]!);
      if (double) dialogueDoubleTransform(real[c]!, imaginary[c]!, packed!, scratch!, doubleCosine!);
      else dialogueSpectrum(real[c]!, imaginary[c]!, cosine!);
      output[c]!.set(input[c]!.subarray(0, count), start);
    }
    let centerFlux = 0, differenceFlux = 0;
    for (let i = 0; i <= size / 2; i++) {
      const sr = real[0]![i]! + real[1]![i]!, si = imaginary[0]![i]! + imaginary[1]![i]!;
      const dr = real[0]![i]! - real[1]![i]!, di = imaginary[0]![i]! - imaginary[1]![i]!;
      // Round the power ratio before the square root, matching FFmpeg's sqrtf input.
      const a = 0.5 * (1 - Math.sqrt(round((dr * dr + di * di) / (sr * sr + si * si + epsilon))));
      cr[i] = a * sr; ci[i] = a * si;
      const center = Math.hypot(cr[i]!, ci[i]!), difference = Math.hypot(dr, di);
      centerFlux += (center - previousCenter[i]!) ** 2;
      differenceFlux += (difference - previousDifference[i]!) ** 2;
      // Native retains the previous transform except for its Nyquist bin.
      if (i < size / 2) { previousCenter[i] = center; previousDifference[i] = difference; }
    }
    const detected = centerFlux + differenceFlux === 0 ? 0 : Math.max(0, Math.min(1, voice * (centerFlux / (centerFlux + differenceFlux) - 0.5)));
    vad = round(0.1 * detected + 0.9 * vad);
    for (let i = 0; i <= size / 2; i++) {
      const power = cr[i]! ** 2 + ci[i]! ** 2;
      const difference = (real[0]![i]! - real[1]![i]!) ** 2 + (imaginary[0]![i]! - imaginary[1]![i]!) ** 2;
      const gain = original + (double ? vad * (power / (power + difference + epsilon)) : vad * power / (power + difference + epsilon)) * enhance;
      cr[i] = cr[i]! * gain; ci[i] = ci[i]! * gain;
      if (!double && i > 0 && i < size / 2) { cr[size - i] = cr[i]!; ci[size - i] = -ci[i]!; }
    }
    if (double) dialogueDoubleTransform(cr, ci, packed!, scratch!, doubleCosine!, true);
    else transform(cr, ci, true);
    for (let i = 0; i < size; i++) overlap[i] = overlap[i]! + (double ? cr[i]! : Math.fround(cr[i]! / (size * 1.5))) * window[i]!;
    output[2]!.set(overlap.subarray(0, count), start);
  }
  return { channels: output, frameSize: hop };
}
