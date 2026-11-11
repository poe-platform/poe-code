import type { MediaBudgetTracker, MediaSample, MediaTrack } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";
import { resampleAudio } from "./audio-resample.js";
import { validateWeaveGenericOption } from "./weave-generic-option.js";

export async function correlateAudio(
  first: MediaTrack, second: MediaTrack, filter: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaTrack> {
  const a = first.decodedAudio;
  const b = second.decodedAudio;
  if (!a || !b) throw new Error("axcorrelate requires decoded PCM audio");
  const layoutA = a.channelMask || (a.channels === 1 ? 4 : a.channels === 2 ? 3 : a.channels === 6 ? 0x3f : undefined);
  const layoutB = b.channelMask || (b.channels === 1 ? 4 : b.channels === 2 ? 3 : b.channels === 6 ? 0x3f : undefined);
  const remix = a.channels !== b.channels &&
    [layoutA, layoutB].every(layout => layout === 4 || layout === 3 || layout === 0x3f);
  if (!remix && (a.channels !== b.channels || layoutA !== layoutB)) {
    throw new Error("axcorrelate requires matching layouts or mono/stereo/5.1 inputs");
  }
  let size = 256;
  let algo = "best";
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  let positional = 0;
  const options = argument ? argument.split(":") : [];
  if (options.at(-1) === "") options.pop();
  for (const option of options) {
    if (option === "") throw new Error("axcorrelate: empty option");
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["size", "algo"][positional++] : option.slice(0, separator);
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "size") {
      size = parseFilterExpression(value, "axcorrelate", { min: 2, max: 131072, default: 256 });
      if (size < 2 || size > 131072) throw new RangeError("axcorrelate: invalid size");
      // Native integer options round to nearest, with halfway values going to even.
      const floor = Math.floor(size);
      size = size - floor === 0.5 ? floor + floor % 2 : Math.round(size);
    } else if (key === "algo") {
      const numeric = parseFilterExpression(value, "axcorrelate", { slow: 0, fast: 1, best: 2, min: 0, max: 2, default: 2 });
      if (numeric < 0 || numeric > 2) throw new RangeError("axcorrelate: invalid algo");
      // Native integer options round ties to even after validating the range.
      const rounded = numeric % 1 === 0.5 ? 2 * Math.round(numeric / 2) : Math.round(numeric);
      algo = ["slow", "fast", "best"][rounded]!;
    } else if (key === "threads" || key === "thread_type" || key === "extra_hw_frames") {
      validateWeaveGenericOption(key, value, "axcorrelate");
    } else throw new Error(`axcorrelate: unsupported option ${key}`);
  }
  let secondChannels = b.channelData;
  if (a.sampleRate !== b.sampleRate) {
    const length = Math.ceil(b.channelData[0]!.length * a.sampleRate / b.sampleRate);
    budget.checkSamples(length);
    budget.checkDuration(length / a.sampleRate);
    budget.allocateMemory(length * b.channels * Float32Array.BYTES_PER_ELEMENT);
    secondChannels = await resampleAudio(b.channelData, length, b.sampleRate, a.sampleRate, budget, signal);
  }
  // Native requests the first input whose FIFO has at most one window left.
  // Once either input reports EOF, only already received packets are drained.
  const tracks = [first, second];
  const lengths = [a.channelData[0]!.length, secondChannels[0]!.length];
  const received = [0, 0];
  const packets = [0, 0];
  const frames: MediaSample[] = [];
  let drained = 0;
  const startPts = Math.round((first.samples[0]?.pts ?? 0) * a.sampleRate / first.timescale);
  function drainTo(end: number): void {
    if (end <= drained) return;
    budget.allocateMemory(96);
    const pts = startPts + drained;
    frames.push({ data: new Uint8Array(0), size: 0, dts: pts, pts, cts: 0,
      duration: end - drained, isKeyframe: true, sampleDescriptionIndex: 1 });
    drained = end;
  }
  for (let requests = 0; ; requests++) {
    if (requests % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
    drainTo(Math.min(...received) - size);
    const input = received[0]! - drained <= size ? 0 : 1;
    if (received[input]! >= lengths[input]!) break;
    const track = tracks[input]!;
    const packet = track.samples[packets[input]!];
    packets[input]!++;
    const count = packet ? Math.round(packet.duration * a.sampleRate / track.timescale)
      - (packet.skipSamples ?? 0) - (packet.discardPadding ?? 0) : lengths[input]! - received[input]!;
    received[input] = Math.min(lengths[input]!, received[input]! + Math.max(0, count));
  }
  const length = Math.min(...received);
  // EOF pads both queues with one window of silence, releasing the tail.
  drainTo(length);
  budget.checkSamples(length);
  budget.checkDuration(length / a.sampleRate);
  budget.allocateMemory(length * a.channels * 8);
  // PCM inputs negotiate float planar samples in native axcorrelate.
  const double = first.codecDescriptions[0]?.codecName === "pcm_f64le";
  const round = double ? (value: number) => value : Math.fround;
  const small = double ? 1e-9 : round(1e-6);
  let remixed: Float32Array | Float64Array | undefined;
  if (remix && length > 0) {
    const Samples = double ? Float64Array : Float32Array;
    budget.allocateMemory(received[1]! * Samples.BYTES_PER_ELEMENT);
    remixed = new Samples(received[1]!);
  }
  const channelData = a.channelData.map(() => new Float64Array(length));
  for (let c = 0; c < a.channels && length > 0; c++) {
    if (remixed) {
      // Float planar mixing preserves equal power without integer normalization.
      // 5.1 speaker order is FL, FR, FC, LFE, BL, BR; omit LFE on downmix.
      const gain = round(Math.SQRT1_2);
      const coefficients = a.channels === 6
        ? Array.from({ length: b.channels }, (_, input) =>
          b.channels === 1 ? (c === 2 ? 1 : 0) : (c === input ? 1 : 0))
        : b.channels === 6
          ? (a.channels === 1 ? [gain, gain, 1, 0, 0.5, 0.5]
            : c === 0 ? [1, 0, gain, 0, gain, 0] : [0, 1, gain, 0, 0, gain])
          : new Array<number>(b.channels).fill(gain);
      for (let i = 0; i < remixed.length; i++) {
        if (i % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        let value = 0;
        for (let input = 0; input < b.channels; input++) {
          if (coefficients[input] === 0) continue;
          value = round(value + round(round(secondChannels[input]![i]!) * coefficients[input]!));
        }
        remixed[i] = value;
      }
    }
    const x = a.channelData[c]!.subarray(0, received[0]);
    const y = remixed ?? secondChannels[c]!.subarray(0, received[1]);
    let sx = 0, sy = 0, xx = 0, yy = 0, xy = 0;
    // Pad past the last packet received, even if the source has more samples.
    for (let i = 0; i < size; i++) {
      if (i % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      const u = round(x[i] ?? 0), v = round(y[i] ?? 0);
      sx = round(sx + u); sy = round(sy + v);
      // Keep multiply-add fused until the float32 accumulator is stored.
      xx = round(xx + u * u); yy = round(yy + v * v); xy = round(xy + u * v);
    }
    for (let i = 0; i < length; i++) {
      if (i % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      let numerator = xy;
      let varianceX = xx, varianceY = yy;
      const meanX = round(sx / size), meanY = round(sy / size);
      if (algo === "slow") {
        numerator = 0; varianceX = 0; varianceY = 0;
        for (let j = 0; j < size; j++) {
          if ((i * size + j) % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          const u = round(round(x[i + j] ?? 0) - meanX), v = round(round(y[i + j] ?? 0) - meanY);
          numerator = round(numerator + round(u * v));
          varianceX = round(varianceX + round(u * u)); varianceY = round(varianceY + round(v * v));
        }
      } else if (algo === "best") {
        numerator = round(numerator - round(size * meanX) * meanY);
        varianceX = round(varianceX - round(size * meanX) * meanX);
        varianceY = round(varianceY - round(size * meanY) * meanY);
      }
      const denominator = algo === "best"
        ? round(round(Math.sqrt(Math.max(0, varianceX))) * round(Math.sqrt(Math.max(0, varianceY))))
        : round(Math.sqrt(round(round(round(varianceX * varianceY) / size) / size)));
      if (algo !== "best") numerator = round(numerator / size);
      channelData[c]![i] = denominator <= small ? 0
        : Math.max(-1, Math.min(1, round(numerator / denominator)));
      const oldX = round(x[i] ?? 0), oldY = round(y[i] ?? 0);
      const newX = round(x[i + size] ?? 0), newY = round(y[i + size] ?? 0);
      // Native removes the outgoing sample before adding the incoming one,
      // rounding each operation so cancellation retains the same residuals.
      sx = round(round(sx - oldX) + newX); sy = round(round(sy - oldY) + newY);
      xx = Math.max(0, round(round(xx - oldX * oldX) + newX * newX));
      yy = Math.max(0, round(round(yy - oldY * oldY) + newY * newY));
      xy = round(round(xy - oldX * oldY) + newX * newY);
    }
  }
  return { ...first, timescale: a.sampleRate, duration: length, samples: frames, editList: undefined,
    decodedAudio: { ...a, channelData } };
}
