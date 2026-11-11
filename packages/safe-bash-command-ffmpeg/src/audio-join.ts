import { audioSpeakerMasks, parseAudioChannelCount, parseAudioChannelLayout } from "./audio-channel-layout.js";
import type { MediaBudgetTracker, MediaSample, MediaTrack } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { convertAudioSampleFormat, resampleAudio } from "./audio-resample.js";
import { parseFilterExpression } from "./filter-expression.js";
import { validateWeaveGenericOption } from "./weave-generic-option.js";

export async function joinAudio(
  tracks: MediaTrack[], filters: string[], budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaTrack> {
  const filter = filters[0]!;
  let inputs = 2;
  let layout = "stereo";
  let map = "";
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const options = argument ? argument.split(":") : [];
  if (options.at(-1) === "") options.pop();
  let positional = 0;
  for (const option of options) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["inputs", "channel_layout", "map"][positional++] : option.slice(0, separator).trim();
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "inputs") {
      const numeric = parseFilterExpression(value, "join", { default: 2, min: 1, max: 2147483647 });
      if (numeric < 1 || numeric > 2147483647) throw new RangeError("join: invalid input count");
      // Native integer options round halfway values to even after range validation.
      inputs = numeric % 1 === 0.5 ? 2 * Math.round(numeric / 2) : Math.round(numeric);
    } else if (key === "channel_layout") {
      if (!validChannelLayout(value)) throw new Error("join: invalid channel layout");
      const speakersStart = value.indexOf(" channels (");
      layout = speakersStart < 0 ? value : value.slice(speakersStart + " channels (".length, -1);
    } else if (key === "map") {
      // This is a native string option; only its final value is interpreted.
      map = value;
    } else if (key === "threads" || key === "thread_type" || key === "extra_hw_frames") {
      validateWeaveGenericOption(key, value, "join");
    } else throw new Error(`join: unsupported option ${key}`);
  }
  if (inputs !== tracks.length) {
    throw new Error("join: inputs must match the number of connected inputs");
  }
  const speakers = Object.keys(audioSpeakerMasks);
  const outputCount = parseAudioChannelCount(layout);
  const outputNames: (string | number)[] = outputCount === undefined
    ? parseAudioChannelLayout(layout) : Array.from({ length: outputCount }, (_, index) => index);
  if (outputCount === undefined && outputNames.some(name => typeof name !== "string" || !speakers.includes(name))) {
    throw new Error(`join: unsupported channel layout ${layout}`);
  }
  // A mask cannot represent repeated speakers; channelLayout retains every output slot.
  const outputMask = new Set(outputNames).size === outputNames.length
    ? outputNames.reduce<number>((mask, name) => mask + (typeof name === "string" ? audioSpeakerMasks[name]! : 0), 0) : 0;
  const audio = tracks.map(track => {
    if (!track.decodedAudio) throw new Error("join requires decoded PCM audio");
    return track.decodedAudio;
  });
  const sampleRate = audio[0]!.sampleRate;
  const formats = tracks.map(track => {
    const codec = track.codecDescriptions[0]?.codecName ?? "";
    return codec === "pcm_u8" ? "u8" : codec.startsWith("pcm_s16") ? "s16"
      : codec.startsWith("pcm_s24") || codec.startsWith("pcm_s32") ? "s32"
        : codec.startsWith("pcm_f32") ? "flt" : "dbl";
  });
  let format = formats[0]!;
  for (const following of filters.slice(1)) {
    const separator = following.indexOf("=");
    const name = (separator < 0 ? following : following.slice(0, separator)).split("@", 1)[0]!.trim();
    if (name !== "volume") continue;
    // Floating-point volume negotiates its precision downstream of join.
    let precision = "float";
    const argument = separator < 0 ? "" : following.slice(separator + 1);
    for (const [index, option] of argument.split(":").entries()) {
      const equals = option.indexOf("=");
      const key = equals < 0 ? ["volume", "precision"][index] : option.slice(0, equals).trim();
      if (key === "precision") precision = (equals < 0 ? option : option.slice(equals + 1)).trim();
    }
    if (precision !== "fixed" && precision !== "0") format = "dbl";
    break;
  }
  for (let index = 0; index < audio.length; index++) {
    let input = audio[index]!;
    let sourceFormat = formats[index]!;
    if (input.sampleRate !== sampleRate) {
      const length = Math.ceil(input.channelData[0]!.length * sampleRate / input.sampleRate);
      budget.checkSamples(length);
      budget.checkDuration(length / sampleRate);
      budget.allocateMemory(length * input.channels * Float32Array.BYTES_PER_ELEMENT);
      input = { ...input, sampleRate,
        channelData: await resampleAudio(input.channelData, length, input.sampleRate, sampleRate, budget, signal) };
      sourceFormat = "flt";
    }
    // Integer inputs discard low bits; floating inputs round to the negotiated format.
    audio[index] = sourceFormat === format ? input : { ...input,
      channelData: await convertAudioSampleFormat(input.channelData, sourceFormat, format, budget, signal) };
  }
  const inputNames = audio.map((input, index) => {
    const layout = tracks[index]!.codecDescriptions[0]?.channelLayout;
    if (layout) return parseAudioChannelLayout(layout);
    const mask = input.channelMask || ([0, 4, 3, 0xb, 0x107, 0x37, 0x3f, 0x70f, 0x63f][input.channels] ?? 0);
    return speakers.filter(name => Math.floor(mask / audioSpeakerMasks[name]!) % 2 === 1);
  });
  const used = audio.map(() => new Set<number>());
  const selected = outputNames.map((): Float32Array | Float64Array | undefined => undefined);
  for (const mapping of map ? map.split("|") : []) {
    const [source, output, ...extra] = mapping.split("-");
    const indices = source!.split(".");
    const outputIndex = outputNames.indexOf(output ?? "");
    if (extra.length || outputIndex < 0 || selected[outputIndex] ||
        indices.length !== 2 || !indices[0] || !indices[1]) {
      throw new Error("join: invalid channel map");
    }
    const inputIndex = readMapIndex(indices[0]);
    if (inputIndex.end !== indices[0].length) throw new Error("join: invalid channel map");
    const input = audio[inputIndex.index];
    if (!input) throw new Error("join: invalid input channel");
    const name = indices[1];
    let channelIndex = readMapIndex(name).index;
    if (Number.isNaN(channelIndex)) {
      channelIndex = inputNames[inputIndex.index]!.indexOf(name);
    }
    const channel = input.channelData[channelIndex];
    if (!channel) throw new Error("join: invalid input channel");
    selected[outputIndex] = channel;
    used[inputIndex.index]!.add(channelIndex);
  }
  // Reserve matching speakers before filling any gaps with unused channels.
  for (const matchSpeaker of [true, false]) {
    for (const [outputIndex, name] of outputNames.entries()) {
      if (selected[outputIndex]) continue;
      for (const [inputIndex, input] of audio.entries()) {
        const channelIndex = matchSpeaker
          ? (typeof name === "string" ? inputNames[inputIndex]!.indexOf(name) : -1)
          : input.channelData.findIndex((_, index) => !used[inputIndex]!.has(index));
        const channel = input.channelData[channelIndex];
        if (!channel || used[inputIndex]!.has(channelIndex)) continue;
        selected[outputIndex] = channel;
        used[inputIndex]!.add(channelIndex);
        break;
      }
    }
  }
  if (selected.some(channel => !channel)) throw new Error("join: not enough unused input channels");
  const length = Math.min(...audio.map(input => input.channelData[0]!.length));
  budget.checkSamples(length);
  budget.checkDuration(length / sampleRate);
  budget.allocateMemory(length * outputNames.length * 8);
  const channelData = outputNames.map(() => new Float64Array(length));
  for (let start = 0; start < length; start += 4096) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    budget.checkCpu();
    for (let index = 0; index < selected.length; index++) {
      const source = selected[index]!;
      const end = Math.min(start + 4096, length);
      channelData[index]!.set(source.subarray(start, end), start);
    }
  }
  // join consumes the other inputs in frames sized by its first input.
  const first = tracks[0]!;
  const frames: MediaSample[] = [];
  for (let start = 0, n = 0; start < length; n++) {
    if (n % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
    const packet = first.samples[n];
    const count = packet ? Math.max(0, Math.round(packet.duration * sampleRate / first.timescale)
      - (packet.skipSamples ?? 0) - (packet.discardPadding ?? 0)) : 1024;
    if (count === 0) continue;
    const end = Math.min(length, start + count);
    const pts = packet ? Math.round(packet.pts * sampleRate / first.timescale)
      + (packet.skipSamples ?? 0) : start;
    budget.allocateMemory(96);
    frames.push({ data: new Uint8Array(0), size: 0, dts: pts, pts, cts: 0,
      duration: end - start, isKeyframe: true, sampleDescriptionIndex: 1 });
    start = end;
  }
  return { ...first, timescale: sampleRate, duration: length, samples: frames, editList: undefined,
    codecDescriptions: first.codecDescriptions.map(description => ({ ...description,
      channels: outputNames.length, channelLayout: outputCount === undefined ? outputNames.join("+") : `${outputCount} channels` })),
    decodedAudio: { ...audio[0]!, channels: outputNames.length, channelMask: outputMask, channelData } };
}

function readMapIndex(source: string): { index: number; end: number } {
  let end = 0;
  while (end < source.length && " \t\n\r\v\f".includes(source[end]!)) end++;
  if (source[end] === "+") end++;
  let radix = source[end] === "0" ? 8 : 10;
  if (source.slice(end, end + 2).toLowerCase() === "0x" &&
      source[end + 2] && "0123456789abcdef".includes(source[end + 2]!.toLowerCase())) {
    radix = 16;
    end += 2;
  }
  const start = end;
  const alphabet = "0123456789abcdef".slice(0, radix);
  while (end < source.length && alphabet.includes(source[end]!.toLowerCase())) end++;
  // Native channel ordinals consume an integer prefix; input ordinals must reach the dot.
  return { index: Number.parseInt(source.slice(start, end), radix), end };
}

function validChannelLayout(layout: string): boolean {
  if (Object.hasOwn(audioSpeakerMasks, layout)) return true;
  if (["mono", "stereo", "2.1", "3.0", "3.0(back)", "4.0", "quad", "quad(side)", "3.1",
    "5.0", "5.0(side)", "4.1", "5.1", "5.1(side)", "6.0", "6.0(front)", "3.1.2", "hexagonal",
    "6.1", "6.1(back)", "6.1(front)", "7.0", "7.0(front)", "7.1", "7.1(wide)", "7.1(wide-side)",
    "5.1.2", "octagonal", "cube", "5.1.4", "7.1.2", "7.1.4", "7.2.3", "9.1.4", "hexadecagonal",
    "downmix", "22.2"].includes(layout)) return true;
  if (layout.startsWith("ambisonic ")) {
    const separator = layout.indexOf("+", 10);
    const order = layout.slice(10, separator < 0 ? undefined : separator);
    if (!order || [...order].some(char => char < "0" || char > "9") || Number(order) > 46339) return false;
    const extra = separator < 0 ? "" : layout.slice(separator + 1);
    return separator < 0 || (!extra.startsWith("ambisonic ") && validChannelLayout(extra));
  }
  const unsigned = layout.trimStart().startsWith("+") ? layout.trimStart().slice(1) : layout.trimStart();
  const hex = unsigned.toLowerCase().startsWith("0x");
  const octal = !hex && unsigned.startsWith("0") && unsigned.length > 1;
  const digits = hex ? unsigned.slice(2) : unsigned;
  const alphabet = hex ? "0123456789abcdefABCDEF" : octal ? "01234567" : "0123456789";
  if (digits && [...digits].every(char => alphabet.includes(char))) {
    const mask = BigInt(octal ? `0o${digits}` : unsigned);
    return mask > 0n && mask <= 0xffffffffffffffffn;
  }
  const suffix = layout.endsWith(" channels") ? " channels" : layout.slice(-1);
  if (["c", "C", " channels"].includes(suffix)) {
    const count = layout.slice(0, -suffix.length);
    if (count && [...count].every(char => char >= "0" && char <= "9")) {
      const channels = Number(count);
      return suffix === "c" ? [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 24].includes(channels)
        : channels > 0 && channels <= 2147483647;
    }
  }
  const start = layout.indexOf(" channels (");
  if (start >= 0) {
    const count = layout.slice(0, start);
    if (!count || [...count].some(char => char < "0" || char > "9") || !layout.endsWith(")")) return false;
    layout = layout.slice(start + " channels (".length, -1);
    if (layout.split("+").length !== Number(count)) return false;
  }
  return layout.split("+").every(channel => ["FL", "FR", "FC", "LFE", "BL", "BR", "FLC", "FRC",
    "BC", "SL", "SR", "TC", "TFL", "TFC", "TFR", "TBL", "TBC", "TBR", "DL", "DR", "WL", "WR",
    "SDL", "SDR", "LFE2", "TSL", "TSR", "BFC", "BFL", "BFR", "UNK", "UNSD"].includes(channel.split("@")[0]!.trim()));
}
