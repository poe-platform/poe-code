import { parseAudioChannelLayout } from "./audio-channel-layout.js";
import type { MediaBudgetTracker, MediaTrack } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

export async function joinAudio(
  tracks: MediaTrack[], filter: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaTrack> {
  const options: Record<string, string> = { inputs: "2", channel_layout: "stereo" };
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["inputs", "channel_layout", "map"][index] : option.slice(0, separator);
    if (!key || !["inputs", "channel_layout", "map"].includes(key)) throw new Error(`join: unsupported option ${key}`);
    options[key] = separator < 0 ? option : option.slice(separator + 1);
  }
  const count = Number(options.inputs);
  if (!Number.isInteger(count) || count < 1 || count > 32767 || count !== tracks.length) {
    throw new Error("join: inputs must match the number of connected inputs");
  }
  const speakers = ["FL", "FR", "FC", "LFE", "BL", "BR", "FLC", "FRC", "BC", "SL", "SR",
    "TC", "TFL", "TFC", "TFR", "TBL", "TBC", "TBR"];
  const outputNames = parseAudioChannelLayout(options.channel_layout!);
  if (outputNames.some(name => !speakers.includes(name)) || new Set(outputNames).size !== outputNames.length) {
    throw new Error(`join: unsupported channel layout ${options.channel_layout}`);
  }
  outputNames.sort((a, b) => speakers.indexOf(a) - speakers.indexOf(b));
  const outputMask = outputNames.reduce((mask, name) => mask | (1 << speakers.indexOf(name)), 0);
  const audio = tracks.map(track => {
    if (!track.decodedAudio) throw new Error("join requires decoded PCM audio");
    return track.decodedAudio;
  });
  if (audio.some(input => input.sampleRate !== audio[0]!.sampleRate)) throw new Error("join requires matching sample rates");
  const used = audio.map(() => new Set<number>());
  const selected = new Map<string, Float32Array | Float64Array>();
  for (const mapping of options.map ? options.map.split("|") : []) {
    const [source, output, ...extra] = mapping.split("-");
    const indices = source!.split(".");
    if (extra.length || !outputNames.includes(output ?? "") || selected.has(output!) ||
        indices.length !== 2 || indices.some(value => !value || [...value].some(char => char < "0" || char > "9"))) {
      throw new Error("join: invalid channel map");
    }
    const channel = audio[Number(indices[0])]?.channelData[Number(indices[1])];
    if (!channel) throw new Error("join: invalid input channel");
    selected.set(output!, channel);
    used[Number(indices[0])]!.add(Number(indices[1]));
  }
  // Reserve matching speakers before filling any gaps with unused channels.
  for (const matchSpeaker of [true, false]) {
    for (const name of outputNames) {
      if (selected.has(name)) continue;
      for (const [inputIndex, input] of audio.entries()) {
        const mask = input.channelMask || ([0, 4, 3, 0xb, 0x107, 0x37, 0x3f, 0x70f, 0x63f][input.channels] ?? 0);
        const inputNames = speakers.filter((_, index) => (mask & (1 << index)) !== 0);
        const channelIndex = matchSpeaker
          ? inputNames.indexOf(name)
          : input.channelData.findIndex((_, index) => !used[inputIndex]!.has(index));
        const channel = input.channelData[channelIndex];
        if (!channel || used[inputIndex]!.has(channelIndex)) continue;
        selected.set(name, channel);
        used[inputIndex]!.add(channelIndex);
        break;
      }
    }
  }
  if (selected.size !== outputNames.length) throw new Error("join: not enough unused input channels");
  const length = Math.min(...audio.map(input => input.channelData[0]!.length));
  const sampleRate = audio[0]!.sampleRate;
  budget.checkSamples(length);
  budget.checkDuration(length / sampleRate);
  budget.allocateMemory(length * outputNames.length * 8);
  const channelData = outputNames.map(() => new Float64Array(length));
  for (let start = 0; start < length; start += 4096) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    budget.checkCpu();
    for (const [index, name] of outputNames.entries()) {
      channelData[index]!.set(selected.get(name)!.subarray(start, Math.min(start + 4096, length)), start);
    }
  }
  return { ...tracks[0]!, timescale: sampleRate, duration: length, samples: [], editList: undefined,
    decodedAudio: { ...audio[0]!, channels: outputNames.length, channelMask: outputMask, channelData } };
}
