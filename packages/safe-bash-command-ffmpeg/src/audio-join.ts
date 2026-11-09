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
  if (options.inputs !== "2" || tracks.length !== 2) throw new Error("join requires two inputs");
  if (options.channel_layout !== "stereo") throw new Error("join: only stereo output is supported");
  const audio = tracks.map(track => {
    if (!track.decodedAudio) throw new Error("join requires decoded PCM audio");
    return track.decodedAudio;
  });
  if (audio[0]!.sampleRate !== audio[1]!.sampleRate) throw new Error("join requires matching sample rates");
  const used = audio.map(() => new Set<number>());
  const selected = new Map<string, Float32Array | Float64Array>();
  for (const mapping of options.map ? options.map.split("|") : []) {
    const [source, output, ...extra] = mapping.split("-");
    const indices = source!.split(".");
    if (extra.length || !["FL", "FR"].includes(output ?? "") || selected.has(output!) ||
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
    for (const [outputIndex, name] of ["FL", "FR"].entries()) {
      if (selected.has(name)) continue;
      for (const [inputIndex, input] of audio.entries()) {
        const mask = input.channelMask || (input.channels === 1 ? 4 : input.channels === 2 ? 3 : 0);
        const channelIndex = matchSpeaker
          ? (mask & (1 << outputIndex) ? (outputIndex === 1 && (mask & 1) ? 1 : 0) : -1)
          : input.channelData.findIndex((_, index) => !used[inputIndex]!.has(index));
        const channel = input.channelData[channelIndex];
        if (!channel || used[inputIndex]!.has(channelIndex)) continue;
        selected.set(name, channel);
        used[inputIndex]!.add(channelIndex);
        break;
      }
    }
  }
  if (selected.size !== 2) throw new Error("join: not enough unused input channels");
  const length = Math.min(...audio.map(input => input.channelData[0]!.length));
  const sampleRate = audio[0]!.sampleRate;
  budget.checkSamples(length);
  budget.checkDuration(length / sampleRate);
  budget.allocateMemory(length * 2 * 8);
  const channelData = [new Float64Array(length), new Float64Array(length)];
  for (let start = 0; start < length; start += 4096) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    budget.checkCpu();
    for (const [index, name] of ["FL", "FR"].entries()) {
      channelData[index]!.set(selected.get(name)!.subarray(start, Math.min(start + 4096, length)), start);
    }
  }
  return { ...tracks[0]!, timescale: sampleRate, duration: length, samples: [], editList: undefined,
    decodedAudio: { ...audio[0]!, channels: 2, channelMask: 3, channelData } };
}
