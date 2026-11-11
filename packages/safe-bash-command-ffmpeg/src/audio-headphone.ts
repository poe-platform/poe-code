import type { MediaBudgetTracker, MediaTrack } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
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
    if (!key || !["map", "gain", "lfe", "type", "size", "hrir"].includes(key)) {
      throw new Error(`headphone: unsupported option ${key}`);
    }
    options[key] = separator < 0 ? option : option.slice(separator + 1);
  }
  const mapping = options.map?.split("|");
  const mono = mapping?.length === 1 && mapping[0] === "FC";
  if (!mapping || (!mono && (mapping.length !== 2 || new Set(mapping).size !== 2 || mapping.some(name => !["FL", "FR"].includes(name))))) {
    throw new Error("headphone: map must assign FC or FL and FR");
  }
  for (const key of ["gain", "lfe"]) {
    const value = Number(options[key]);
    if (!options[key]?.trim() || !Number.isFinite(value) || value < -20 || value > 40) {
      throw new Error(`headphone: ${key} must be between -20 and 40 dB`);
    }
  }
  if (!["time", "freq", "0", "1"].includes(options.type!)) throw new Error("headphone: invalid processing type");
  const size = Number(options.size);
  if (!Number.isInteger(size) || size < 1024 || size > 96000) throw new Error("headphone: invalid frame size");
  if (!["stereo", "0"].includes(options.hrir!)) throw new Error("headphone: only separate stereo impulse responses are supported");
  if (tracks.length !== mapping.length + 1) throw new Error("headphone requires one stereo impulse response per mapped source channel");
  const audio = tracks.map((track, index) => {
    const decoded = track.decodedAudio;
    const channels = index === 0 && mono ? 1 : 2;
    const mask = channels === 1 ? 4 : 3;
    if (!decoded || decoded.channels !== channels || (decoded.channelMask !== undefined && decoded.channelMask !== mask)) {
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
  // Both processing modes implement the same causal convolution; keep only the source duration.
  let work = 0;
  for (const [response, name] of mapping.entries()) {
    const input = source.channelData[name === "FR" ? 1 : 0]!;
    for (let ear = 0; ear < 2; ear++) {
      const impulse = audio[response + 1]!.channelData[ear]!;
      const output = channelData[ear]!;
      for (let tap = 0; tap < Math.min(impulse.length, length); tap++) {
        const coefficient = Math.fround(impulse[tap]! * gain);
        for (let sample = 0; sample < length - tap; sample++) {
          if (work++ % 4096 === 0) {
            await yieldTurn(signal);
            signal?.throwIfAborted();
            budget.checkCpu();
          }
          output[sample + tap] = output[sample + tap]! + Math.fround(input[sample]! * coefficient);
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
