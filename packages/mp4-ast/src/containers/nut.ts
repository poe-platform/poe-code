import { MediaBudgetTracker, type MediaAstPlugin, type MediaDocument, type MediaSample, type MediaTrack, type ParseMediaOptions } from "../types.js";
import { buildProbeResultFromDoc } from "../mp4.js";
import { concatBytes } from "../binary.js";
import { rawAudioAsts } from "./raw-audio.js";

const signature = new TextEncoder().encode("nut/multimedia container\0");
const startcodes = ["4e4d7a561f5f04ad", "4e5311405bf2f9db", "4e4be4adeeca4569", "4e49ab68b596ba78", "4e58dd672f23e64e"];
const rawAudio = rawAudioAsts();

type FrameCode = { flags: number; delta: number; mul: number; stream: number; size: number; reserved: number; header: number };
type Stream = { track: MediaTrack; samples: MediaSample[]; numerator: number; shift: number; lastPts: number; format: string | undefined };

function parseNut(bytes: Uint8Array, options: ParseMediaOptions = {}): MediaDocument {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.length);
  if (!signature.every((byte, i) => bytes[i] === byte)) throw new Error("Invalid NUT signature");
  let pos = signature.length, end = bytes.length;
  const take = (size: number): Uint8Array => {
    if (!Number.isSafeInteger(size) || size < 0 || size > end - pos) throw new Error("Invalid NUT data bounds");
    const result = bytes.subarray(pos, pos + size);
    pos += size;
    return result;
  };
  const v = (): number => {
    let value = 0;
    for (let i = 0; i < 8; i++) {
      const byte = take(1)[0]!;
      value = value * 128 + (byte & 127);
      if (!Number.isSafeInteger(value)) break;
      if (byte < 128) return value;
    }
    throw new Error("Invalid NUT integer");
  };
  const s = (): number => { const value = v() + 1; return value % 2 ? -Math.floor(value / 2) : value / 2; };
  const crc = (data: Uint8Array): void => {
    let value = 0;
    for (let i = 0; i < data.length; i++) {
      if (i % 4096 === 0) budget.checkCpu();
      value ^= data[i]! << 24;
      for (let bit = 0; bit < 8; bit++) value = (value << 1) ^ (value < 0 ? 0x04c11db7 : 0);
    }
    if (value !== 0) throw new Error("Invalid NUT header checksum");
  };
  const bases: { num: number; den: number }[] = [];
  const codes: FrameCode[] = [];
  const headers: Uint8Array[] = [new Uint8Array()];
  const streams: Stream[] = [];
  let streamCount = 0;
  while (pos < bytes.length) {
    budget.checkCpu();
    if (bytes[pos] === 78) {
      const start = pos;
      const code = Array.from(take(8), byte => byte.toString(16).padStart(2, "0")).join("");
      if (!startcodes.includes(code)) throw new Error("Invalid NUT startcode");
      const length = v();
      if (length > 4096) { take(4); crc(bytes.subarray(start, pos)); }
      if (length < 4 || length > bytes.length - pos) throw new Error("Invalid NUT header bounds");
      const payload = pos;
      const packetEnd = pos + length;
      crc(bytes.subarray(payload, packetEnd));
      end = packetEnd - 4;
      if (code === startcodes[0] && codes.length === 0) {
        const version = v();
        if (version !== 3) throw new Error(`Unsupported NUT version ${version}`);
        streamCount = v();
        if (!streamCount || streamCount > bytes.length) throw new Error("Invalid NUT stream count");
        budget.checkStreams(streamCount);
        v(); // Maximum distance between syncpoints.
        const count = v();
        if (!count || count > (end - pos) / 2) throw new Error("Invalid NUT time bases");
        for (let i = 0; i < count; i++) {
          const num = v(), den = v();
          if (!num || !den || num >= 2 ** 31 || den >= 2 ** 31) throw new Error("Invalid NUT time base");
          bases.push({ num, den });
        }
        let delta = 0, mul = 1, stream = 0, header = 0;
        for (let i = 0; i < 256;) {
          const flags = v(), fields = v();
          if (fields > 0) delta = s();
          if (fields > 1) mul = v();
          if (fields > 2) stream = v();
          const size = fields > 3 ? v() : 0;
          const reserved = fields > 4 ? v() : 0;
          const count = fields > 5 ? v() : mul - size;
          if (fields > 6) s();
          if (fields > 7) header = v();
          for (let field = 8; field < fields; field++) v();
          if (count <= 0 || count > 256 - i - (i <= 78 ? 1 : 0) || stream >= streamCount) throw new Error("Invalid NUT frame table");
          for (let j = 0; j < count; i++) {
            if (i === 78) { codes[i] = { flags: 8192, delta: 0, mul: 0, stream: 0, size: 0, reserved: 0, header: 0 }; continue; }
            codes[i] = { flags, delta, mul, stream, size: size + j++, reserved, header };
          }
        }
        if (pos < end) {
          const count = v();
          if (count >= 128) throw new Error("Invalid NUT elision headers");
          let total = 0;
          for (let i = 0; i < count; i++) {
            const length = v();
            total += length;
            if (!length || length >= 256 || total > 1024) throw new Error("Invalid NUT elision header");
            headers.push(take(length));
          }
        }
      } else if (code === startcodes[1]) {
        const id = v(), kind = v();
        if (id >= streamCount) throw new Error("Invalid NUT stream id");
        const tag = take(v());
        if (tag.length !== 4) throw new Error("Unsupported NUT codec tag");
        const fourcc = String.fromCharCode(...tag);
        const base = bases[v()];
        const shift = v();
        if (!base || shift >= 16) throw new Error("Invalid NUT stream time base");
        v(); v(); v(); // Timestamp distance, decode delay, stream flags.
        take(v()); // Codec-specific data (PCM and packed RGB need none).
        let format: string | undefined;
        let description: MediaTrack["codecDescriptions"][number];
        if (kind === 1) {
          const le = tag[0] === 80;
          const bits = le ? tag[3]! : tag[0]!;
          const type = le ? tag[1] : tag[2];
          if ((!le && tag[3] !== 80) || (le ? tag[2] : tag[1]) !== 68 || ![83, 85, 70].includes(type!)) throw new Error("Unsupported NUT audio codec");
          format = `${type === 83 ? "s" : type === 85 ? "u" : "f"}${bits}${bits === 8 ? "" : le ? "le" : "be"}`;
          if (!rawAudio.some(plugin => plugin.id === format) && format !== "s64le" && format !== "s64be") throw new Error("Unsupported NUT PCM format");
          const sampleRate = v(), denominator = v(), channels = v();
          if (!sampleRate || denominator !== 1 || !channels || channels > 65535) throw new Error("Invalid NUT audio parameters");
          description = { formatFourCC: fourcc, codecName: `pcm_${format}`, sampleRate, channels, bitsPerSample: bits };
        } else if (kind === 0 && (fourcc === "RGB\x18" || fourcc === "BGR\x18")) {
          const width = v(), height = v(), sarWidth = v(), sarHeight = v();
          v();
          if (!width || !height) throw new Error("Invalid NUT video dimensions");
          description = { formatFourCC: fourcc, codecName: "rawvideo", width, height, sarWidth, sarHeight,
            pixFmt: tag[0] === 82 ? "rgb24" : "bgr24" };
        } else throw new Error("Unsupported NUT stream codec");
        if (!streams[id]) {
          const samples: MediaSample[] = [];
          streams[id] = { numerator: base.num, shift, lastPts: 0, samples, format,
            track: { id: id + 1, type: kind === 1 ? "audio" : "video", handlerType: kind === 1 ? "soun" : "vide",
              timescale: base.den, duration: 0, language: "und", enabled: true,
              width: description.width, height: description.height, codecDescriptions: [description], samples } };
        }
      } else if (code === startcodes[2]) {
        const timestamp = v();
        const base = bases[timestamp % bases.length];
        if (!base) throw new Error("Invalid NUT syncpoint");
        v();
        for (const stream of streams) {
          if (!stream) throw new Error("Missing NUT stream header");
          stream.lastPts = Math.floor(Math.floor(timestamp / bases.length) * base.num / base.den * stream.track.timescale / stream.numerator);
        }
      }
      pos = packetEnd;
      end = bytes.length;
      continue;
    }
    const code = codes[take(1)[0]!];
    if (!code || code.flags & 8192) throw new Error("Invalid NUT frame code");
    let { flags, stream: id, size, reserved, header } = code;
    if (flags & 4096) flags ^= v();
    if (flags & 16) id = v();
    const stream = streams[id];
    if (!stream || flags & (8192 | 256)) throw new Error("Unsupported NUT frame flags or stream");
    let pts = stream.lastPts + code.delta;
    if (flags & 8) {
      const coded = v(), wrap = 2 ** stream.shift;
      const origin = stream.lastPts - Math.floor(wrap / 2);
      pts = coded < wrap ? ((coded - origin) % wrap + wrap) % wrap + origin : coded - wrap;
    }
    if (flags & 32) size += code.mul * v();
    if (flags & 2048) s();
    if (flags & 1024) header = v();
    if (flags & 128) reserved = v();
    for (let i = 0; i < reserved; i++) v();
    if (!headers[header]) throw new Error("Invalid NUT elision index");
    if (size > 4096) header = 0;
    if (flags & 64) take(4);
    budget.checkSamples(stream.samples.length + 1);
    const prefix = headers[header]!;
    const offset = pos;
    const payload = take(size - prefix.length);
    if (prefix.length) budget.allocateMemory(size);
    const data = prefix.length ? concatBytes([prefix, payload]) : payload;
    stream.lastPts = pts;
    pts *= stream.numerator;
    if (!Number.isSafeInteger(pts)) throw new Error("Invalid NUT timestamp");
    budget.checkDuration(Math.max(0, pts / stream.track.timescale));
    stream.samples.push({ data, size, offset, pts, dts: pts, cts: 0, duration: 0,
      isKeyframe: Boolean(flags & 1), sampleDescriptionIndex: 1 });
  }
  if (!streamCount || streams.filter(Boolean).length !== streamCount) throw new Error("Missing NUT stream headers");
  const tracks = streams.map(stream => {
    const { track, format } = stream;
    const desc = track.codecDescriptions[0]!;
    const samples = stream.samples.map((sample, i, all) => ({ ...sample,
      duration: track.type === "audio" ? Math.floor(sample.size / (desc.channels! * desc.bitsPerSample! / 8)) * track.timescale / desc.sampleRate!
        : (all[i + 1]?.pts ?? sample.pts + (i ? sample.pts - all[i - 1]!.pts : stream.numerator)) - sample.pts }));
    const duration = samples.reduce((max, sample) => Math.max(max, sample.pts + sample.duration), 0);
    budget.checkDuration(duration / track.timescale);
    let decodedAudio: MediaTrack["decodedAudio"];
    if (format && options.decodeAudio !== false) {
      const size = samples.reduce((sum, sample) => sum + sample.size, 0);
      budget.allocateMemory(size);
      const data = concatBytes(samples.map(sample => sample.data));
      if (format === "s64le" || format === "s64be") {
        const channels = desc.channels!, frames = Math.floor(data.length / (8 * channels));
        budget.allocateMemory(frames * channels * 8);
        const channelData = Array.from({ length: channels }, () => new Float64Array(frames));
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        for (let i = 0; i < frames; i++) {
          if (i % 4096 === 0) budget.checkCpu();
          for (let ch = 0; ch < channels; ch++) {
            // FFmpeg's PCM64 decoder uses the high 32 bits as its s64 sample value.
            channelData[ch]![i] = view.getInt32((i * channels + ch) * 8 + (format === "s64le" ? 4 : 0), format === "s64le") / 2147483648;
          }
        }
        decodedAudio = { sampleRate: desc.sampleRate!, channels, channelData };
      } else decodedAudio = rawAudio.find(plugin => plugin.id === format)!.parse(data,
        { ...options, budget, sampleRate: desc.sampleRate, channels: desc.channels }).tracks[0]!.decodedAudio;
    }
    return { ...track, samples, duration, decodedAudio };
  });
  const durationSeconds = Math.max(...tracks.map(track => track.duration / track.timescale));
  return { containerFormat: "nut", timescale: 1000, duration: durationSeconds * 1000, durationSeconds,
    byteLength: bytes.length, metadata: {}, tracks };
}

export function nutAst(): MediaAstPlugin {
  return {
    id: "nut", formatName: "nut", formatLongName: "NUT", extensions: ["nut"], mimeTypes: ["video/x-nut"],
    canDemux: true, canMux: false, supportedVideoCodecs: ["rawvideo"],
    supportedAudioCodecs: [...rawAudio.map(plugin => `pcm_${plugin.id}`), "pcm_s64le", "pcm_s64be"],
    detect: bytes => signature.every((byte, i) => bytes[i] === byte),
    parse: parseNut,
    probe(bytes, options = {}) {
      return buildProbeResultFromDoc(parseNut(bytes, { ...options, decodeAudio: false }), bytes.length, options.filename,
        { ...options, formatName: "nut", formatLongName: "NUT" });
    },
    serialize() { throw new Error("NUT output is not supported"); }
  };
}
