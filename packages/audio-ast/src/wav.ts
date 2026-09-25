import { Reader, ascii, cleanText, duration, join, uint32 } from "./binary.js";
import type { AudioAst, AudioNode, AudioTags, PcmAudio, WavOptions } from "./types.js";

const infoNames: Record<string, string> = {
  INAM: "title",
  IART: "artist",
  IPRD: "album",
  ITRK: "track",
  ICMT: "comment",
  ICRD: "date",
  IGNR: "genre",
  ISFT: "encoder",
  ICOP: "copyright"
};
export function riffChunk(type: string, data: Uint8Array): Uint8Array {
  return join([ascii(type), uint32(data.length, true), data, new Uint8Array(data.length % 2)]);
}
export function wavInfo(tags: AudioTags): Uint8Array {
  return riffChunk(
    "LIST",
    join([
      ascii("INFO"),
      ...Object.entries(tags).map(([key, value]) => {
        const id = Object.keys(infoNames).find((name) => infoNames[name] === key) ?? key;
        if (id.length !== 4) throw new Error(`Unsupported WAV tag: ${key}`);
        return riffChunk(id, join([new TextEncoder().encode(value), new Uint8Array(1)]));
      })
    ])
  );
}
export function parseWav(bytes: Uint8Array): AudioAst {
  const r = new Reader(bytes);
  if (r.text(0, 4) !== "RIFF" || r.text(8, 4) !== "WAVE") throw new Error("Expected RIFF WAVE");
  const end = r.u32(4, true) + 8;
  r.check(0, end);
  const nodes: AudioNode[] = [],
    tags: AudioTags = {};
  let format = 0,
    sampleRate = 0,
    channels = 0,
    bits = 0,
    validBits = 0,
    align = 0,
    dataSize = 0;
  for (let offset = 12; offset < end; ) {
    const type = r.text(offset, 4),
      size = r.u32(offset + 4, true),
      start = offset + 8;
    if (size > end - start) throw new Error("WAV chunk exceeds RIFF bounds");
    const node: AudioNode = { type, offset, size: size + 8, data: r.slice(start, size) };
    nodes.push(node);
    if (type === "fmt ") {
      if (size < 16) throw new Error("Short WAV fmt chunk");
      format = r.u16(start, true);
      channels = r.u16(start + 2, true);
      sampleRate = r.u32(start + 4, true);
      align = r.u16(start + 12, true);
      bits = r.u16(start + 14, true);
      validBits = bits;
      node.fields = {
        format,
        channels,
        sampleRate,
        byteRate: r.u32(start + 8, true),
        blockAlign: align,
        bitsPerSample: bits
      };
      if (format === 0xfffe) {
        if (size < 40 || r.u16(start + 16, true) < 22) throw new Error("Short extensible WAV fmt");
        validBits = r.u16(start + 18, true) || bits;
        const guid = r.slice(start + 24, 16);
        if (
          !guid
            .subarray(2)
            .every((v, i) => v === [0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113][i])
        )
          throw new Error("Unsupported WAV subformat GUID");
        format = r.u16(start + 24, true);
        Object.assign(node.fields, {
          validBitsPerSample: validBits,
          channelMask: r.u32(start + 20, true),
          subformat: format
        });
      }
    } else if (type === "data") dataSize += size;
    else if (type === "fact") {
      if (size < 4) throw new Error("Short WAV fact");
      node.fields = { samples: r.u32(start, true) };
    } else if (type === "bext") {
      if (size < 602) throw new Error("Short Broadcast Wave extension");
      node.fields = {
        description: cleanText(r.text(start, 256)),
        originator: cleanText(r.text(start + 256, 32)),
        originatorReference: cleanText(r.text(start + 288, 32)),
        originationDate: r.text(start + 320, 10),
        originationTime: r.text(start + 330, 8),
        timeReference: r.u64(start + 338, true),
        version: r.u16(start + 346, true),
        umid: r.slice(start + 348, 64),
        codingHistory: r.text(start + 602, size - 602)
      };
    } else if (type === "LIST" && size >= 4 && r.text(start, 4) === "INFO") {
      node.children = [];
      for (let pos = start + 4; pos < start + size; ) {
        const id = r.text(pos, 4),
          length = r.u32(pos + 4, true);
        if (length > start + size - pos - 8) throw new Error("WAV INFO exceeds LIST bounds");
        const data = r.slice(pos + 8, length);
        node.children.push({ type: id, offset: pos, size: length + 8, data });
        tags[infoNames[id] ?? id] = cleanText(new TextDecoder().decode(data));
        pos += 8 + length + (length % 2);
      }
    }
    offset = start + size + (size % 2);
    if (offset > end) throw new Error("Missing WAV chunk padding");
  }
  if (!nodes.some((n) => n.type === "fmt ") || !nodes.some((n) => n.type === "data"))
    throw new Error("WAV requires fmt and data");
  if (
    !channels ||
    !sampleRate ||
    !align ||
    align !== (channels * bits) / 8 ||
    dataSize % align ||
    validBits > bits ||
    validBits <= 0
  )
    throw new Error("Inconsistent WAV sample layout");
  if (
    (format !== 1 && format !== 3) ||
    (format === 1 && ![8, 16, 24, 32].includes(bits)) ||
    (format === 3 && ![32, 64].includes(bits))
  )
    throw new Error("Unsupported WAV encoding");
  const samples = dataSize / align,
    seconds = duration(samples, sampleRate);
  return {
    format: "wav",
    data: bytes,
    nodes,
    tags,
    pictures: [],
    streams: [
      {
        codec: format === 3 ? "pcm_float" : "pcm",
        sampleRate,
        channels,
        bitsPerSample: bits,
        samples,
        duration: seconds,
        bitrate: sampleRate * align * 8
      }
    ],
    duration: seconds,
    bitrate: seconds ? (bytes.length * 8) / seconds : 0
  };
}
export function decodePcm(bytes: Uint8Array | AudioAst): PcmAudio {
  const ast = bytes instanceof Uint8Array ? parseWav(bytes) : bytes;
  if (ast.format !== "wav") throw new Error("PCM decoding supports WAV PCM/IEEE float only");
  const stream = ast.streams[0]!;
  const bits = stream.bitsPerSample!,
    width = bits / 8;
  const channels = Array.from({ length: stream.channels }, () => new Float64Array(stream.samples));
  let frame = 0;
  for (const node of ast.nodes.filter((n) => n.type === "data")) {
    const r = new Reader(node.data);
    for (let offset = 0; offset < node.data.length; offset += width * stream.channels, frame++) {
      for (let ch = 0; ch < stream.channels; ch++) {
        const pos = offset + ch * width;
        let sample: number;
        if (stream.codec === "pcm_float")
          sample = bits === 32 ? r.view.getFloat32(pos, true) : r.view.getFloat64(pos, true);
        else if (bits === 8) sample = (r.u8(pos) - 128) / 128;
        else if (bits === 16) sample = r.view.getInt16(pos, true) / 32768;
        else if (bits === 24) {
          const raw = r.u24(pos, true);
          sample = (raw >= 0x800000 ? raw - 0x1000000 : raw) / 0x800000;
        } else sample = r.view.getInt32(pos, true) / 0x80000000;
        if (!Number.isFinite(sample)) throw new Error("Non-finite PCM sample");
        channels[ch]![frame] = sample;
      }
    }
  }
  return { sampleRate: stream.sampleRate, channels };
}
export function validatePcm(pcm: PcmAudio): number {
  const length = pcm.channels[0]?.length;
  if (
    !Number.isInteger(pcm.sampleRate) ||
    pcm.sampleRate <= 0 ||
    pcm.sampleRate > 0xffffffff ||
    length === undefined ||
    pcm.channels.length > 65535 ||
    pcm.channels.some((ch) => ch.length !== length || ch.some((v) => !Number.isFinite(v)))
  )
    throw new Error("Invalid PCM audio");
  return length;
}
export function encodeWav(pcm: PcmAudio, options: WavOptions = {}): Uint8Array {
  const frames = validatePcm(pcm),
    bits = options.bitsPerSample ?? 16,
    float = options.float ?? false;
  if ((float && ![32, 64].includes(bits)) || (!float && ![8, 16, 24, 32].includes(bits)))
    throw new Error("Unsupported WAV precision");
  const align = (pcm.channels.length * bits) / 8;
  if (align > 65535 || pcm.sampleRate * align > 0xffffffff || frames * align > 0xffffffff - 4096)
    throw new Error("WAV exceeds RIFF size limits");
  const fmt = new Uint8Array(16),
    view = new DataView(fmt.buffer);
  view.setUint16(0, float ? 3 : 1, true);
  view.setUint16(2, pcm.channels.length, true);
  view.setUint32(4, pcm.sampleRate, true);
  view.setUint32(8, pcm.sampleRate * align, true);
  view.setUint16(12, align, true);
  view.setUint16(14, bits, true);
  const data = new Uint8Array(frames * align),
    out = new DataView(data.buffer);
  for (let frame = 0; frame < frames; frame++)
    for (let ch = 0; ch < pcm.channels.length; ch++) {
      const pos = frame * align + (ch * bits) / 8,
        value = pcm.channels[ch]![frame]!;
      if (float) {
        if (bits === 32) out.setFloat32(pos, value, true);
        else out.setFloat64(pos, value, true);
      } else {
        const scale = 2 ** (bits - 1),
          sample = Math.max(-scale, Math.min(scale - 1, Math.round(value * scale)));
        if (bits === 8) out.setUint8(pos, sample + 128);
        else if (bits === 16) out.setInt16(pos, sample, true);
        else if (bits === 24) {
          data[pos] = sample & 255;
          data[pos + 1] = (sample >> 8) & 255;
          data[pos + 2] = (sample >> 16) & 255;
        } else out.setInt32(pos, sample, true);
      }
    }
  const chunks = [riffChunk("fmt ", fmt)];
  if (float) chunks.push(riffChunk("fact", uint32(frames, true)));
  if (options.tags) chunks.push(wavInfo(options.tags));
  chunks.push(riffChunk("data", data));
  const body = join([ascii("WAVE"), ...chunks]);
  return join([ascii("RIFF"), uint32(body.length, true), body]);
}
