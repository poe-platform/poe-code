import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";
import { parseFilterBoolean } from "./filter-boolean.js";
import { audioSpeakerMasks, parseAudioChannelLayout } from "./audio-channel-layout.js";

export async function passAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  sampleFormat: string, budget: MediaBudgetTracker, signal?: AbortSignal, channelNames?: readonly string[],
  frames: readonly { start: number; end: number; pts: number; pos?: number | undefined }[] = [{ start: 0, end: channels[0]?.length ?? 0, pts: 0 }]
): Promise<{ channels: (Float32Array | Float64Array)[]; sampleFormat: string }> {
  const name = filter.split("=", 1)[0]!.split("@", 1)[0]!;
  const lowpass = name === "lowpass";
  const bandpass = name === "bandpass";
  const equalizer = name === "equalizer";
  const bandreject = name === "bandreject";
  const lowShelf = name === "bass" || name === "lowshelf";
  const shelf = lowShelf || name === "treble" || name === "highshelf";
  let csg = false;
  let enable: string | undefined;
  let precision = -1;
  let normalize = false;
  let selected: string[] | undefined;
  const options = { frequency: equalizer ? 0 : lowShelf ? 100 : lowpass ? 500 : 3000, poles: 2, mix: 1, width: equalizer ? 1 : shelf || bandpass || bandreject ? 0.5 : 0.707, width_type: 3, blocksize: 0, gain: 0 };
  const aliases: Record<string, keyof typeof options> = {
    frequency: "frequency", f: "frequency", poles: "poles", p: "poles", mix: "mix", m: "mix",
    width: "width", w: "width", width_type: "width_type", t: "width_type",
    blocksize: "blocksize", b: "blocksize"
  };
  if (bandpass || bandreject || equalizer) { delete aliases.poles; delete aliases.p; }
  if (shelf || equalizer) { aliases.gain = "gain"; aliases.g = "gain"; }
  const positional = ["frequency", "width_type", "width",
    ...(shelf ? ["gain", "poles"] : name === "equalizer" ? ["gain"] : bandpass ? ["csg"]
      : lowpass || name === "highpass" ? ["poles"] : []),
    "mix", "channels", "normalize", "transform", "precision", "blocksize"];
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const entries = argument ? argument.split(":") : [];
  if (entries.at(-1) === "") entries.pop();
  let position = 0;
  for (const option of entries) {
    const separator = option.indexOf("=");
    const optionName = separator < 0 ? positional[position] : option.slice(0, separator).trim();
    // Named options restart FFmpeg's shorthand cursor, skipping the first slot
    // only when it was the slot just visited.
    position = separator < 0 ? position + 1 : position === 0 ? 1 : 0;
    if (!optionName) throw new Error(`${name}: too many positional options`);
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (bandpass && optionName === "csg") {
      csg = parseFilterBoolean(value, "bandpass: invalid csg");
      continue;
    }
    if (optionName === "enable") {
      enable = value;
      // Validate without advancing the per-filter expression state.
      parseFilterExpression(enable, `${name} enable`, {
        n: 0, t: 0, pos: NaN, w: 0, h: 0, E: Math.E, PI: Math.PI, PHI: (1 + Math.sqrt(5)) / 2
      }, undefined, new Float64Array(10));
      continue;
    }
    if (optionName === "normalize" || optionName === "n") {
      normalize = parseFilterBoolean(value, `${name}: invalid normalize`);
      continue;
    }
    if (optionName === "precision" || optionName === "r") {
      const number = parseFilterExpression(value, name, { auto: -1, s16: 0, s32: 1, f32: 2, f64: 3 });
      if (!value || !Number.isFinite(number) || number < -1 || number > 3) throw new Error(`${name}: invalid precision`);
      precision = number % 1 === 0.5 ? 2 * Math.round(number / 2) : Math.round(number);
      continue;
    }
    if (optionName === "c" || optionName === "channels") {
      selected = value === "all" ? undefined : parseAudioChannelLayout(value);
      if (selected?.some(channel => !Object.hasOwn(audioSpeakerMasks, channel))) {
        // Biquad channel strings without a valid speaker layout select nothing.
        selected = [];
      }
      continue;
    }
    const key = Object.hasOwn(aliases, optionName) ? aliases[optionName] : undefined;
    if (!key) throw new Error(`${name}: unsupported option ${optionName}`);
    const widthTypes: Record<string, number> = { h: 1, o: 2, q: 3, s: 4, k: 5 };
    const number = key === "frequency" || key === "width" || key === "gain"
      ? parseFilterExpression(value, name, { PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2 })
      : key === "width_type" && Object.hasOwn(widthTypes, value) ? widthTypes[value]! : Number(value);
    if (!value || !Number.isFinite(number)
      || key === "frequency" && (number < 0 || number > 999999)
      || key === "gain" && (number < -900 || number > 900)
      || key === "poles" && number !== 1 && number !== 2
      || key === "width" && (number < 0 || number > 99999)
      || key === "blocksize" && (number < 0 || number > 32768)
      || key === "width_type" && (!Number.isInteger(number) || number < 1 || number > 5)
      || key === "mix" && (number < 0 || number > 1)) throw new Error(`${name}: invalid ${key}`);
    options[key] = key === "blocksize"
      ? (number % 1 === 0.5 ? 2 * Math.round(number / 2) : Math.round(number)) : number;
  }
  const inputFormat = sampleFormat;
  if (precision !== -1) sampleFormat = ["s16p", "s32p", "fltp", "dblp"][precision]!;
  else if (!sampleFormat.endsWith("p")) sampleFormat += "p";
  const single = sampleFormat === "fltp" || sampleFormat === "s16p";
  const scale = sampleFormat === "s16p" ? 32768 : sampleFormat === "s32p" ? 2147483648 : 1;
  const convert = (value: number) => {
    if (sampleFormat === "fltp") return Math.fround(value);
    if (scale === 1) return value;
    const scaled = value * scale;
    const rounded = scaled % 1 === 0.5 || scaled % 1 === -0.5 ? 2 * Math.round(scaled / 2) : Math.round(scaled);
    return Math.max(-scale, Math.min(scale - 1, rounded)) / scale;
  };
  signal?.throwIfAborted();
  if (sampleFormat !== inputFormat && sampleFormat !== `${inputFormat}p` && sampleFormat !== "dblp") {
    const converted: Float64Array[] = [];
    for (const channel of channels) {
      budget.allocateMemory(channel.length * 8);
      const samples = new Float64Array(channel.length);
      for (let i = 0; i < channel.length; i++) {
        if (i % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        samples[i] = convert(channel[i]!);
      }
      converted.push(samples);
    }
    channels = converted;
  }
  signal?.throwIfAborted();
  budget.checkCpu();
  // Native FFmpeg bypasses an out-of-band cutoff when configuring the filter.
  if (options.mix === 0 || options.width === 0 || options.frequency === 0 || options.frequency > sampleRate / 2) return { channels: [...channels], sampleFormat };
  const angle = 2 * Math.PI * options.frequency / sampleRate;
  const sine = Math.sin(angle);
  const amplitude = Math.pow(10, options.gain / 40);
  let alpha = sine / (2 * options.width);
  switch (options.width_type) {
    case 1: alpha = sine * options.width / (2 * options.frequency); break;
    case 2: alpha = sine * Math.sinh(Math.LN2 / 2 * options.width * angle / sine); break;
    case 4: alpha = sine / 2 * Math.sqrt(shelf || equalizer
      ? (amplitude + 1 / amplitude) * (1 / options.width - 1) + 2 : 2 / options.width); break;
    case 5: alpha = sine * options.width * 1000 / (2 * options.frequency); break;
  }
  let a1, a2, b0, b1, b2;
  if (equalizer) {
    const denominator = 1 + alpha / amplitude;
    a1 = -2 * Math.cos(angle) / denominator;
    a2 = (1 - alpha / amplitude) / denominator;
    b0 = (1 + alpha * amplitude) / denominator;
    b1 = a1;
    b2 = (1 - alpha * amplitude) / denominator;
  } else if (shelf) {
    const cosine = Math.cos(angle);
    const direction = lowShelf ? 1 : -1;
    // bass and treble retain the legacy shelf slope; the shelf aliases use RBJ coefficients.
    const beta = name === "bass" || name === "treble"
      ? Math.sqrt((amplitude * amplitude + 1) - (amplitude - 1) * (amplitude - 1))
      : 2 * Math.sqrt(amplitude);
    let denominator;
    if (options.poles === 1) {
      const gain = Math.pow(10, options.gain / 20);
      const ro = -direction * Math.sin(angle / 2 - Math.PI / 4) / Math.sin(angle / 2 + Math.PI / 4);
      const n = (gain + 1) / (gain - 1);
      const alpha1 = gain === 1 ? 0 : n - Math.sign(n) * Math.sqrt(n * n - 1);
      const beta0 = ((1 + gain) + (1 - gain) * alpha1) * 0.5;
      const beta1 = ((1 - gain) + (1 + gain) * alpha1) * 0.5;
      denominator = 1 + ro * alpha1;
      a1 = -direction * (ro + alpha1);
      a2 = 0;
      b0 = beta0 + ro * beta1;
      b1 = -direction * (beta1 + ro * beta0);
      b2 = 0;
    } else {
      denominator = (amplitude + 1) + direction * (amplitude - 1) * cosine + beta * alpha;
      a1 = -2 * (direction * (amplitude - 1) + (amplitude + 1) * cosine);
      a2 = (amplitude + 1) + direction * (amplitude - 1) * cosine - beta * alpha;
      b0 = amplitude * ((amplitude + 1) - direction * (amplitude - 1) * cosine + beta * alpha);
      b1 = 2 * amplitude * (direction * (amplitude - 1) - (amplitude + 1) * cosine);
      b2 = amplitude * ((amplitude + 1) - direction * (amplitude - 1) * cosine - beta * alpha);
    }
    a1 /= denominator; a2 /= denominator;
    b0 /= denominator; b1 /= denominator; b2 /= denominator;
  } else {
    const a0 = options.poles === 1 ? 1 : 1 + alpha;
    a1 = options.poles === 1 ? -Math.exp(-angle) : -2 * Math.cos(angle) / a0;
    a2 = options.poles === 1 ? 0 : (1 - alpha) / a0;
    b0 = bandreject ? 1 / a0 : bandpass ? (csg ? sine / 2 : alpha) / a0 : options.poles === 1
      ? lowpass ? 1 + a1 : (1 - a1) / 2
      : (1 + (lowpass ? -Math.cos(angle) : Math.cos(angle))) / (2 * a0);
    b1 = bandreject ? a1 : bandpass ? 0 : options.poles === 1 ? lowpass ? 0 : -b0 : (lowpass ? 2 : -2) * b0;
    b2 = bandpass ? -b0 : options.poles === 1 ? 0 : b0;
  }
  // Match FFmpeg's DC normalization before rounding coefficients to float.
  if (normalize && Math.abs(b0 + b1 + b2) > 1e-6) {
    const factor = (1 + a1 + a2) / (b0 + b1 + b2);
    b0 *= factor; b1 *= factor; b2 *= factor;
  }
  if (single) {
    a1 = Math.fround(a1); a2 = Math.fround(a2);
    b0 = Math.fround(b0); b1 = Math.fround(b1); b2 = Math.fround(b2);
  }
  // Native PCM16 and float modes round every operation to single precision.
  const wet = single ? Math.fround(options.mix) : options.mix;
  const dry = single ? Math.fround(1 - wet) : 1 - wet;
  const filterSample = (input: number, x1: number, x2: number, y1: number, y2: number) => single
    ? Math.fround(Math.fround(Math.fround(Math.fround(Math.fround(x2 * b2) + Math.fround(x1 * b1))
      + Math.fround(input * b0)) - Math.fround(y2 * a2)) - Math.fround(y1 * a1))
    : x2 * b2 + x1 * b1 + input * b0 - y2 * a2 - y1 * a1;
  const mixSample = (filtered: number, input: number) => {
    const mixed = single ? Math.fround(Math.fround(filtered * wet) + Math.fround(input * dry)) : filtered * wet + input * dry;
    return scale === 1 ? mixed : Math.max(-scale, Math.min(scale - 1, Math.trunc(mixed * scale))) / scale;
  };
  const output: (Float32Array | Float64Array)[] = [];
  channelNames ??= channels.length === 1 ? ["FC"] : channels.length === 2 ? ["FL", "FR"] : [];
  const blocksize = options.blocksize;
  budget.allocateMemory(blocksize * 2 * 8);
  const block = new Float64Array(blocksize * 2);
  let work = 0;
  let enabledFrames: Uint8Array | undefined;
  if (enable !== undefined) {
    const count = blocksize ? Math.ceil((channels[0]?.length ?? 0) / blocksize) : frames.length;
    budget.allocateMemory(count + 80);
    enabledFrames = new Uint8Array(count);
    const registers = new Float64Array(10);
    const randomStates: BigUint64Array[] = [];
    let frameIndex = 0;
    for (let n = 0; n < count; n++) {
      if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      const start = blocksize ? n * blocksize : frames[n]!.start;
      while (frameIndex + 1 < frames.length && frames[frameIndex]!.end <= start) frameIndex++;
      const frame = frames[frameIndex]!;
      const variables = {
        n, t: (frame.pts + start - frame.start) / sampleRate,
        pos: frame.pos !== undefined && frame.pos >= 0 ? frame.pos : NaN,
        w: 0, h: 0, E: Math.E, PI: Math.PI, PHI: (1 + Math.sqrt(5)) / 2
      };
      // Biquads evaluate their internal timeline once per consumed frame.
      enabledFrames[n] = Number(Math.abs(parseFilterExpression(enable, `${name} enable`, variables, undefined, registers, randomStates)) >= 0.5);
    }
  }
  for (const [index, channel] of channels.entries()) {
    if (selected && !selected.includes(channelNames[index] ?? "")) {
      if (blocksize) {
        budget.allocateMemory(channel.length * 8);
        const samples = new Float64Array(channel.length);
        // Native bypass copies the lookahead block, then flushes silence at EOF.
        for (let i = 0; i + blocksize < channel.length; i++) {
          if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          samples[i] = channel[i + blocksize]!;
        }
        output.push(samples);
      } else {
        output.push(channel);
      }
      continue;
    }
    budget.allocateMemory(channel.length * 8);
    const samples = new Float64Array(channel.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    if (blocksize) {
      block.fill(0);
      for (let offset = 0; offset < channel.length; offset += blocksize) {
        const enabled = enabledFrames === undefined || enabledFrames[offset / blocksize] === 1;
        // Refilter the previous block and lookahead with the current timeline state.
        // Only the previous block's forward history persists between calls.
        let savedX1 = x1, savedX2 = x2, savedY1 = y1, savedY2 = y2;
        for (let i = 0; i < block.length; i++) {
          if (++work % 1024 === 0) {
            await yieldTurn(signal);
            signal?.throwIfAborted();
            budget.checkCpu();
          }
          const input = channel[offset - blocksize + i] ?? 0;
          const filtered = filterSample(input, x1, x2, y1, y2);
          x2 = x1; x1 = input;
          y2 = y1; y1 = filtered;
          block[i] = enabled ? mixSample(filtered, input) : input;
          if (i === blocksize - 1) {
            savedX1 = x1; savedX2 = x2; savedY1 = y1; savedY2 = y2;
          }
        }
        x1 = savedX1; x2 = savedX2; y1 = savedY1; y2 = savedY2;
        let rx1 = 0, rx2 = 0, ry1 = 0, ry2 = 0;
        const last = offset + blocksize >= channel.length;
        for (let i = block.length - 1; i >= 0; i--) {
          if (++work % 1024 === 0) {
            await yieldTurn(signal);
            signal?.throwIfAborted();
            budget.checkCpu();
          }
          const input = block[i]!;
          const filtered = filterSample(input, rx1, rx2, ry1, ry2);
          rx2 = rx1; rx1 = input;
          ry2 = ry1; ry1 = filtered;
          const position = offset - blocksize + i;
          // At EOF FFmpeg emits the cached second half without another pass.
          if ((i < blocksize || last) && position >= 0 && position < channel.length) {
            samples[position] = enabled ? mixSample(filtered, input) : input;
          }
        }
      }
      output.push(samples);
      continue;
    }
    for (let i = 0; i < channel.length; i++) {
      if (++work % 1024 === 0) {
        await yieldTurn(signal);
        signal?.throwIfAborted();
        budget.checkCpu();
      }
      const input = channel[i]!;
      const filtered = filterSample(input, x1, x2, y1, y2);
      x2 = x1; x1 = input;
      y2 = y1; y1 = filtered;
      samples[i] = mixSample(filtered, input);
    }
    output.push(samples);
  }
  if (enabledFrames && !blocksize) {
    for (const [n, frame] of frames.entries()) {
      if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      if (enabledFrames[n]) continue;
      // Biquads keep updating their history while disabled, returning the input.
      for (const [c, channel] of channels.entries()) {
        output[c]!.set(channel.subarray(frame.start, frame.end), frame.start);
      }
    }
  }
  return { channels: output, sampleFormat };
}
