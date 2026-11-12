import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";
import { parseFilterBoolean } from "./filter-boolean.js";
import { audioSpeakerMasks, parseAudioChannelLayout } from "./audio-channel-layout.js";

export function parsePassOptions(filter: string) {
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
  let transform = 0;
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
    if (optionName === "threads" || optionName === "extra_hw_frames") {
      const minimum = optionName === "extra_hw_frames" ? -1 : 0;
      const number = parseFilterExpression(value, name, {
        default: minimum, min: minimum, max: 2147483647,
        PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
      });
      if (!Number.isFinite(number) || number < minimum || number > 2147483647) {
        throw new Error(`${name}: invalid ${optionName}`);
      }
      // Scheduling and hardware-frame hints do not affect this CPU implementation.
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
    if (optionName === "transform" || optionName === "a") {
      const number = parseFilterExpression(value, name, {
        di: 0, dii: 1, tdi: 2, tdii: 3, latt: 4, svf: 5, zdf: 6, min: 0, max: 6, default: 0
      });
      if (!value || !Number.isFinite(number) || number < 0 || number > 6) throw new Error(`${name}: invalid transform`);
      transform = number % 1 === 0.5 ? 2 * Math.round(number / 2) : Math.round(number);
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
      || key === "poles" && (number < 1 || number > 2)
      || key === "width" && (number < 0 || number > 99999)
      || key === "blocksize" && (number < 0 || number > 32768)
      || key === "width_type" && (number < 1 || number > 5)
      || key === "mix" && (number < 0 || number > 1)) throw new Error(`${name}: invalid ${key}`);
    options[key] = key === "blocksize" || key === "poles" || key === "width_type"
      ? (number % 1 === 0.5 ? 2 * Math.round(number / 2) : Math.round(number)) : number;
  }
  return { ...options, precision, transform, selected, enable, normalize, csg };
}

export async function passAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  sampleFormat: string, budget: MediaBudgetTracker, signal?: AbortSignal, channelNames?: readonly string[],
  frames: readonly { start: number; end: number; pts: number; pos?: number | undefined }[] = [{ start: 0, end: channels[0]?.length ?? 0, pts: 0 }],
  commands: readonly { sample: number; action: string; expression: string }[] = []
): Promise<{ channels: (Float32Array | Float64Array)[]; sampleFormat: string; blocksize: number }> {
  const name = filter.split("=", 1)[0]!.split("@", 1)[0]!;
  const lowpass = name === "lowpass";
  const bandpass = name === "bandpass";
  const equalizer = name === "equalizer";
  const bandreject = name === "bandreject";
  const lowShelf = name === "bass" || name === "lowshelf";
  const shelf = lowShelf || name === "treble" || name === "highshelf";
  const { precision, transform, selected, enable, normalize, csg, ...options } = parsePassOptions(filter);
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
  const initialFrequency = options.frequency;
  const initialGain = options.gain;
  let a0 = 1, a1 = 0, a2 = 0, b0 = 0, b1 = 0, b2 = 0;
  let bypass = false;
  const configure = () => {
    bypass = (options.mix === 0 || options.width === 0 || options.frequency === 0 || options.frequency > sampleRate / 2);
    if (bypass) return;
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
    a0 = 1;
    if (transform === 4) {
      const k0 = a1 / (1 + a2);
      b1 -= b2 * a1;
      b0 = b0 - b1 * k0 - b2 * a2;
      a1 = k0;
    } else if (transform === 5) {
      const directB0 = b0;
      b0 = b1 - a1 * directB0;
      b1 = b2 - a2 * directB0;
      b2 = directB0;
      a1 = -a1; a2 = -a2;
    } else if (transform === 6) {
      let q = options.width;
      switch (options.width_type) {
        case 1: q = options.frequency / options.width; break;
        case 2: q = 1 / (2 * Math.sinh(Math.LN2 / 2 * options.width * angle / sine)); break;
        case 4: q = 1 / Math.sqrt((amplitude + 1 / amplitude) * (1 / options.width - 1) + 2); break;
        case 5: q = options.frequency / (options.width * 1000); break;
      }
      const tangent = Math.tan(angle / 2);
      const g = shelf ? lowShelf ? tangent / Math.sqrt(amplitude) : tangent * Math.sqrt(amplitude) : tangent;
      const k = 1 / (equalizer ? q * amplitude : q);
      a0 = 1 / (1 + g * (g + k));
      a1 = g * a0; a2 = g * a1;
      b0 = shelf ? lowShelf ? 1 : amplitude * amplitude : lowpass || bandpass ? 0 : 1;
      b1 = shelf ? lowShelf ? k * (amplitude - 1) : k * (1 - amplitude) * amplitude : equalizer ? k * (amplitude * amplitude - 1) : bandpass ? csg ? 1 : k : lowpass ? 0 : -k;
      b2 = shelf ? lowShelf ? amplitude * amplitude - 1 : 1 - amplitude * amplitude : bandpass || bandreject || equalizer ? 0 : lowpass ? 1 : -1;
    }
    if (single) {
      a0 = Math.fround(a0);
      a1 = Math.fround(a1); a2 = Math.fround(a2);
      b0 = Math.fround(b0); b1 = Math.fround(b1); b2 = Math.fround(b2);
    }
  };
  configure();
  if (bypass && commands.length === 0) return { channels: [...channels], sampleFormat, blocksize: options.blocksize };
  // Native PCM16 and float modes round every operation to single precision.
  const wet = single ? Math.fround(options.mix) : options.mix;
  const dry = single ? Math.fround(1 - wet) : 1 - wet;
  const round = single ? Math.fround : (value: number) => value;
  const filterSample = (input: number, state: Float64Array, enabled: boolean) => {
    const s0 = state[0]!, s1 = state[1]!, s2 = state[2]!, s3 = state[3]!;
    let filtered: number;
    switch (transform) {
      case 1: { // Direct form II.
        const w0 = round(round(input - round(a1 * s0)) - round(a2 * s1));
        filtered = round(round(round(b0 * w0) + round(b1 * s0)) + round(b2 * s1));
        state[0] = w0; state[1] = s0;
        break;
      }
      case 2: { // Transposed direct form I also uses the feedback input for its dry mix.
        input = round(input + s0);
        filtered = round(round(b0 * input) + s2);
        state[0] = round(round(-a1 * input) + s1); state[1] = round(-a2 * input);
        state[2] = round(round(b1 * input) + s3); state[3] = round(b2 * input);
        break;
      }
      case 3: // Transposed direct form II.
        filtered = round(round(b0 * input) + s0);
        state[0] = round(round(round(b1 * input) + s1) - round(a1 * filtered));
        state[1] = round(round(b2 * input) - round(a2 * filtered));
        break;
      case 4: { // Lattice-ladder.
        let t0 = round(input - round(a2 * s0));
        let t1 = round(round(t0 * a2) + s0);
        filtered = round(t1 * b2);
        t0 = round(t0 - round(a1 * s1));
        t1 = round(round(t0 * a1) + s1);
        filtered = round(round(filtered + round(t1 * b1)) + round(t0 * b0));
        state[0] = t1; state[1] = t0;
        break;
      }
      case 5: // State variable.
        filtered = round(round(b2 * input) + s0);
        state[0] = round(round(round(b0 * input) + round(a1 * s0)) + s1);
        state[1] = round(round(b1 * input) + round(a2 * s0));
        break;
      case 6: { // Zero-delay state variable.
        const v3 = round(input - s1);
        const v1 = round(round(a0 * s0) + round(a1 * v3));
        const v2 = round(round(s1 + round(a1 * s0)) + round(a2 * v3));
        state[0] = round(round(2 * v1) - s0); state[1] = round(round(2 * v2) - s1);
        filtered = round(round(round(b0 * input) + round(b1 * v1)) + round(b2 * v2));
        break;
      }
      default: // Direct form I (the native default).
        filtered = round(round(round(round(round(s1 * b2) + round(s0 * b1))
          + round(input * b0)) - round(s3 * a2)) - round(s2 * a1));
        state[0] = input; state[1] = s0; state[2] = filtered; state[3] = s2;
    }
    const mixed = enabled ? round(round(filtered * wet) + round(input * dry)) : input;
    return scale === 1 ? mixed : Math.max(-scale, Math.min(scale - 1, Math.trunc(mixed * scale))) / scale;
  };
  const output: (Float32Array | Float64Array)[] = [];
  channelNames ??= channels.length === 1 ? ["FC"] : channels.length === 2 ? ["FL", "FR"] : [];
  const blocksize = options.blocksize;
  budget.allocateMemory(blocksize * 2 * 8 + 3 * 4 * 8);
  const state = new Float64Array(4);
  const savedState = new Float64Array(4);
  const reverseState = new Float64Array(4);
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
    options.frequency = initialFrequency;
    options.gain = initialGain;
    configure();
    let nextCommand = 0;
    const applyCommands = (sample: number) => {
      while (nextCommand < commands.length && commands[nextCommand]!.sample <= sample) {
        budget.checkCpu();
        const command = commands[nextCommand++]!;
        const key = command.action === "f" || command.action === "frequency" ? "frequency"
          : (command.action === "g" || command.action === "gain") && (shelf || equalizer) ? "gain" : undefined;
        if (!key) continue;
        try {
          const value = parseFilterExpression(command.expression, name, { PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2 });
          if (!Number.isFinite(value) || (key === "frequency" ? value < 0 || value > 999999 : value < -900 || value > 900)) continue;
          options[key] = value;
          configure();
        } catch { /* Native asendcmd keeps the previous setting after a rejected command. */ }
      }
    };
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
    state.fill(0);
    if (blocksize) {
      block.fill(0);
      for (let offset = 0; offset < channel.length; offset += blocksize) {
        applyCommands(offset);
        const enabled = enabledFrames === undefined || enabledFrames[offset / blocksize] === 1;
        // Refilter the previous block and lookahead with the current timeline state.
        // Only the previous block's forward history persists between calls.
        savedState.set(state);
        for (let i = 0; i < block.length; i++) {
          if (++work % 1024 === 0) {
            await yieldTurn(signal);
            signal?.throwIfAborted();
            budget.checkCpu();
          }
          const input = channel[offset - blocksize + i] ?? 0;
          if (bypass) { block[i] = input; continue; }
          block[i] = filterSample(input, state, enabled);
          if (i === blocksize - 1) {
            savedState.set(state);
          }
        }
        state.set(savedState);
        reverseState.fill(0);
        const last = offset + blocksize >= channel.length;
        for (let i = block.length - 1; i >= 0; i--) {
          if (++work % 1024 === 0) {
            await yieldTurn(signal);
            signal?.throwIfAborted();
            budget.checkCpu();
          }
          const input = block[i]!;
          const filtered = bypass ? input : filterSample(input, reverseState, enabled);
          const position = offset - blocksize + i;
          // At EOF FFmpeg emits the cached second half without another pass.
          if ((i < blocksize || last) && position >= 0 && position < channel.length) {
            samples[position] = filtered;
          }
        }
      }
      output.push(samples);
      continue;
    }
    let frameIndex = 0;
    for (let i = 0; i < channel.length; i++) {
      applyCommands(i);
      if (++work % 1024 === 0) {
        await yieldTurn(signal);
        signal?.throwIfAborted();
        budget.checkCpu();
      }
      const input = channel[i]!;
      if (bypass) { samples[i] = input; continue; }
      while (frameIndex + 1 < frames.length && frames[frameIndex]!.end <= i) frameIndex++;
      samples[i] = filterSample(input, state, enabledFrames === undefined || enabledFrames[frameIndex] === 1);
    }
    output.push(samples);
  }
  return { channels: output, sampleFormat, blocksize };
}
