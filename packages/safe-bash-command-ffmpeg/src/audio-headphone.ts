import type { MediaBudgetTracker, MediaTrack } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { splitRadix } from "./audio-dialogue-fft.js";
import { parseFilterExpression } from "./filter-expression.js";
import { validateWeaveGenericOption } from "./weave-generic-option.js";
import { resampleAudio } from "./audio-resample.js";

export async function headphoneAudio(
  tracks: MediaTrack[], filter: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaTrack> {
  const options: Record<string, string> = { gain: "0", lfe: "0", type: "freq", size: "1024", hrir: "stereo" };
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const values = argument ? argument.split(":") : [];
  if (values.at(-1) === "") values.pop();
  for (const [index, option] of values.entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["map", "gain", "lfe", "type", "size", "hrir"][index] : option.slice(0, separator);
    if (key === "threads" || key === "thread_type" || key === "extra_hw_frames") {
      validateWeaveGenericOption(key, option.slice(separator + 1), "headphone");
      continue;
    }
    if (!key || !["map", "gain", "lfe", "type", "size", "hrir"].includes(key)) {
      throw new Error(`headphone: unsupported option ${key}`);
    }
    const value = separator < 0 ? option : option.slice(separator + 1);
    if (key === "gain" || key === "lfe") {
      const gain = Number(value);
      if (!value.trim() || !Number.isFinite(gain)) {
        throw new Error(`headphone: ${key} must be between -20 and 40 dB`);
      }
      if (gain < -20 || gain > 40) {
        throw new RangeError(`headphone: ${key} must be between -20 and 40 dB`);
      }
    let value = separator < 0 ? option : option.slice(separator + 1);
    if (key !== "map") {
      const min = key === "gain" || key === "lfe" ? -20 : key === "size" ? 1024 : 0;
      const max = key === "gain" || key === "lfe" ? 40 : key === "size" ? 96000 : 1;
      const fallback = key === "size" ? 1024 : key === "type" ? 1 : 0;
      const diagnostic = key === "gain" || key === "lfe" ? `${key} must be between -20 and 40 dB`
        : key === "type" ? "invalid processing type" : key === "size" ? "invalid frame size" : "invalid impulse response format";
      let numeric: number;
      try {
        numeric = parseFilterExpression(value, "headphone", {
        E: Math.E, PI: Math.PI, PHI: (1 + Math.sqrt(5)) / 2,
        min, max, default: fallback, none: 0, all: -1,
        ...(key === "type" ? { time: 0, freq: 1 } : key === "hrir" ? { stereo: 0, multich: 1 } : {})
      }, undefined, new Float64Array(10));
      } catch {
        throw new Error(`headphone: ${diagnostic}`);
      }

      if (!value.trim() || !Number.isFinite(numeric)) {
        throw new Error(`headphone: ${diagnostic}`);
      }
      if (numeric < min || numeric > max) throw new RangeError(`headphone: ${diagnostic}`);
      // Native integer options validate before rounding ties to even.
      value = String(key === "gain" || key === "lfe" ? numeric
        : numeric % 1 === 0.5 ? 2 * Math.round(numeric / 2) : Math.round(numeric));
    }
    options[key] = value;
  }
  const mapping = options.map?.split("|");
  const mono = mapping?.length === 1 && mapping[0] === "FC";
  if (!mapping || (!mono && (mapping.length !== 2 || new Set(mapping).size !== 2 || mapping.some(name => !["FL", "FR"].includes(name))))) {
    throw new Error("headphone: map must assign FC or FL and FR");
  }
  const size = Number(options.size);
  const multich = options.hrir === "multich" || options.hrir === "1";
  if (tracks.length !== (multich ? 2 : mapping.length + 1)) {
    throw new Error(multich ? "headphone requires one packed impulse response input" : "headphone requires one stereo impulse response per mapped source channel");
  }
  const audio = tracks.map((track, index) => {
    const decoded = track.decodedAudio;
    const channels = index === 0 && mono ? 1 : 2;
    const mask = channels === 1 ? 4 : 3;
    if (multich && index > 0) {
      if (!decoded || decoded.channels < mapping.length * 2) {
        throw new Error("headphone requires a packed stereo impulse response pair per mapped source channel");
      }
    } else if (!decoded || decoded.channels !== channels || (decoded.channelMask !== undefined && decoded.channelMask !== mask)) {
      throw new Error("headphone requires a source matching the map and stereo PCM impulse responses");
    }
    return decoded;
  });
  const source = audio[0]!;
  for (let index = 1; index < audio.length; index++) {
    const response = audio[index]!;
    if (response.sampleRate === source.sampleRate) continue;
    const length = Math.ceil(response.channelData[0]!.length * source.sampleRate / response.sampleRate);
    budget.checkSamples(length);
    budget.checkDuration(length / source.sampleRate);
    budget.allocateMemory(length * response.channels * Float32Array.BYTES_PER_ELEMENT);
    audio[index] = { ...response, sampleRate: source.sampleRate,
      channelData: await resampleAudio(response.channelData, length, response.sampleRate, source.sampleRate, budget, signal) };
  }
  if (audio.slice(1).some(input => !input.channelData[0]!.length)) throw new Error("headphone requires nonempty impulse responses");
  const length = source.channelData[0]!.length;
  budget.checkSamples(length);
  budget.checkDuration(length / source.sampleRate);
  budget.allocateMemory(length * 2 * 4);
  const channelData = [new Float32Array(length), new Float32Array(length)];
  // FFmpeg attenuates by 3 dB per source channel before applying the HRIR.
  const gain = Math.fround(Math.exp((Number(options.gain) - 3 * source.channels) / 20 * Math.LN10));
  const irLength = Math.max(...audio.slice(1).map(input => input.channelData[0]!.length));
  const responses = mapping.map((name, response) => ({
    input: source.channelData[name === "FR" ? 1 : 0]!,
    impulse: [0, 1].map(ear => multich ? audio[1]!.channelData[response * 2 + ear]!
      : audio[response + 1]!.channelData[ear]!)
  }));
  let work = 0;
  const f = Math.fround;
  await yieldTurn(signal);
  signal?.throwIfAborted();
  budget.checkCpu();
  if (options.type === "time" || options.type === "0") {
    budget.allocateMemory((irLength + 32) * 4);
    const coefficients = new Float32Array(irLength);
    const lanes = new Float32Array(32);
    for (const { input, impulse } of responses) {
      for (let ear = 0; ear < 2; ear++) {
        const ir = impulse[ear]!;
        coefficients.fill(0);
        for (let tap = 0; tap < ir.length; tap++) coefficients[tap] = f(ir[ir.length - tap - 1]!) * gain;
        const output = channelData[ear]!;
        for (let sample = 0; sample < length; sample++) {
          if (sample % 4096 === 0) {
            await yieldTurn(signal);
            signal?.throwIfAborted();
            budget.checkCpu();
          }
          lanes.fill(0);
          // Native scalarproduct_float uses 32 fused accumulation lanes on x86.
          for (let tap = Math.max(0, irLength - 1 - sample); tap < ir.length; tap++) {
            if (work++ % 4096 === 0) {
              await yieldTurn(signal);
              signal?.throwIfAborted();
              budget.checkCpu();
            }
            const lane = tap % 32;
            lanes[lane] = f(input[sample - irLength + 1 + tap]!) * coefficients[tap]! + lanes[lane]!;
          }
          for (let stride = 16; stride >= 1; stride /= 2) {
            for (let lane = 0; lane < stride; lane++) lanes[lane] = lanes[lane]! + lanes[lane + stride]!;
          }
          output[sample] = output[sample]! + lanes[0]!;
        }
      }
    }
  } else {
    // Native uses a complex FFT strictly larger than the block plus HRIR.
    const fftSize = 2 ** (Math.floor(Math.log2(irLength + size)) + 1);
    budget.allocateMemory((responses.length * 2 + 3) * fftSize * 2 * 8 + (fftSize / 2 + 1) * 4);
    const cosine = Float32Array.from({ length: fftSize / 2 + 1 }, (_, i) =>
      i === fftSize / 2 ? 0 : Math.cos(Math.PI * i / fftSize));
    const input = new Float64Array(fftSize * 2);
    const spectrum = new Float64Array(fftSize * 2);
    const accumulator = new Float64Array(fftSize * 2);
    const hrtf = responses.map(({ impulse }) => impulse.map(ir => {
      input.fill(0);
      for (let tap = 0; tap < ir.length; tap++) input[2 * tap] = f(f(ir[tap]!) * gain);
      const response = new Float64Array(fftSize * 2);
      splitRadix(input, response, cosine, 0, 1, fftSize, 0);
      budget.checkCpu();
      return response;
    }));
    for (let start = 0; start < length; start += size) {
      const count = Math.min(size, length - start);
      for (let ear = 0; ear < 2; ear++) {
        accumulator.fill(0);
        for (let channel = 0; channel < responses.length; channel++) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
          input.fill(0);
          for (let sample = 0; sample < count; sample++) input[2 * sample] = f(responses[channel]!.input[start + sample]!);
          splitRadix(input, spectrum, cosine, 0, 1, fftSize, 0);
          const response = hrtf[channel]![ear]!;
          for (let bin = 0; bin < fftSize * 2; bin += 2) {
            const re = spectrum[bin]!, im = spectrum[bin + 1]!;
            accumulator[bin] = f(accumulator[bin]! + f(f(re * response[bin]!) - f(im * response[bin + 1]!)));
            accumulator[bin + 1] = f(accumulator[bin + 1]! + f(f(re * response[bin + 1]!) + f(im * response[bin]!)));
          }
        }
        splitRadix(accumulator, spectrum, cosine, 0, -1, fftSize, 0);
        const output = channelData[ear]!;
        for (let sample = 0; sample < Math.min(count + irLength - 1, length - start); sample++) {
          output[start + sample] = output[start + sample]! + f(spectrum[2 * sample]! / fftSize);
        }
      }
    }
  }
  // Reframe output by size while retaining the source clock at each block's start.
  budget.allocateMemory(Math.ceil(length / size) * 96);
  const samples: MediaTrack["samples"][number][] = [];
  let packetIndex = 0;
  let packetStart = 0;
  let packetEnd = 0;
  let packetPts = 0;
  for (let start = 0; start < length; start += size) {
    budget.checkCpu();
    while (packetEnd <= start) {
      budget.checkCpu();
      const packet = tracks[0]!.samples[packetIndex++];
      packetStart = packetEnd;
      packetPts = packet ? packet.pts * source.sampleRate / tracks[0]!.timescale + (packet.skipSamples ?? 0) : packetStart;
      packetEnd += packet ? Math.max(0, Math.round(packet.duration * source.sampleRate / tracks[0]!.timescale)
        - (packet.skipSamples ?? 0) - (packet.discardPadding ?? 0)) : length - packetEnd;
    }
    const pts = packetPts + start - packetStart;
    samples.push({ data: new Uint8Array(0), size: 0, pts, dts: pts, cts: 0,
      duration: Math.min(size, length - start), isKeyframe: true, sampleDescriptionIndex: 1 });
  }
  return { ...tracks[0]!, timescale: source.sampleRate, duration: length, samples, editList: undefined,
    decodedAudio: { ...source, channels: 2, channelMask: 3, channelData } };
}
