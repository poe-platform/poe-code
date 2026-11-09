import { BitReader, BitWriter } from "../binary.js";
import { decodeAacTrack } from "../aac.js";
import { MediaBudgetTracker, type MediaDocument, type MediaSample, type ParseMediaOptions } from "../types.js";

export function isLoas(bytes: Uint8Array, offset = 0): boolean {
  return offset + 3 <= bytes.length && bytes[offset] === 0x56 && (bytes[offset + 1]! & 0xe0) === 0xe0;
}

export function parseLoas(bytes: Uint8Array, options: ParseMediaOptions = {}): MediaDocument {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.length);
  budget.checkStreams(1);
  const samples: MediaSample[] = [], aac: MediaSample[] = [];
  let sampleRate = 0, channels = 0, offset = 0, pts = 0;
  let asc: Uint8Array = new Uint8Array();
  // The raw AAC demuxers share a clock covering every standard AAC sample rate.
  const timescale = 28224000;
  while (offset < bytes.length) {
    budget.checkCpu();
    if (!isLoas(bytes, offset)) throw new Error("Invalid LOAS sync header");
    const size = 3 + ((bytes[offset + 1]! & 31) << 8) + bytes[offset + 2]!;
    if (offset + size > bytes.length) throw new Error("Truncated LOAS packet");
    const bits = new BitReader(bytes.subarray(offset + 3, offset + size));
    function read(count: number): number {
      if (bits.bitsRemaining < count) throw new Error("Truncated LATM payload");
      return bits.readBits(count);
    }
    if (!read(1)) { // useSameStreamMux
      if (read(1) !== 0) throw new Error("Unsupported LATM audioMuxVersion");
      if (read(1) !== 1 || read(6) !== 0 || read(4) !== 0 || read(3) !== 0) {
        throw new Error("Unsupported LATM subframes, programs or layers");
      }
      const configStart = bits.bitOffset;
      if (read(5) !== 2) throw new Error("Unsupported LATM audio object type (requires AAC-LC)");
      const frequency = read(4);
      const rate = frequency === 15 ? read(24) :
        [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350][frequency];
      const channelConfig = read(4);
      const count = [0, 1, 2, 3, 4, 5, 6, 8][channelConfig];
      if (!rate || !count || timescale % rate !== 0) throw new Error("Unsupported LATM sample rate or channel configuration");
      // GASpecificConfig: 1024 samples, no core dependency or extension.
      if (read(3) !== 0) throw new Error("Unsupported LATM AAC frame configuration");
      const config = new BitReader(bits.bytes, configStart), writer = new BitWriter();
      while (config.bitOffset < bits.bitOffset) writer.writeBit(config.readBit());
      asc = writer.toUint8Array();
      if (read(3) !== 0) throw new Error("Unsupported LATM frame length type");
      read(8); // latmBufferFullness
      if (read(1)) throw new Error("Unsupported LATM otherDataPresent");
      if (read(1)) read(8); // crcCheckPresent, crcCheckSum
      if (sampleRate && (sampleRate !== rate || channels !== count)) throw new Error("Changing LATM audio configuration is not supported");
      sampleRate = rate;
      channels = count;
    } else if (!sampleRate) {
      throw new Error("LATM packet has no initial StreamMuxConfig");
    }
    let length = 0, part: number;
    do { part = read(8); length += part; } while (part === 255);
    if (!length || length * 8 > bits.bitsRemaining) throw new Error("Truncated LATM AAC payload");
    const duration = 1024 * timescale / sampleRate;
    budget.checkSamples(samples.length + 1);
    budget.checkDuration((pts + duration) / timescale);
    budget.allocateMemory(128);
    const sample: MediaSample = { data: bytes.subarray(offset, offset + size), offset, size,
      dts: pts, pts, cts: 0, duration, isKeyframe: true, sampleDescriptionIndex: 1 };
    samples.push(sample);
    if (options.decodeAudio !== false) {
      budget.recordFrame(0, 0);
      budget.allocateMemory(length + 128 + 1024 * channels * 4);
      const data = new Uint8Array(length);
      for (let i = 0; i < length; i++) data[i] = read(8);
      aac.push({ ...sample, data, size: length });
    }
    offset += size;
    pts += duration;
  }
  if (!samples.length) throw new Error("Empty LOAS stream");
  const track = {
    id: 1, type: "audio" as const, handlerType: "soun", timescale, duration: pts,
    language: "und", enabled: true, samples,
    codecDescriptions: [{ formatFourCC: "\0\0\0\0", codecName: "aac_latm", profile: "LC",
      sampleRate, channels, bitsPerSample: 0,
      esds: { objectTypeIndication: 0x40, audioObjectType: 2, sampleRate, channelCount: channels,
        maxBitrate: 0, avgBitrate: 0, decoderSpecificInfo: asc, rawEsdsBytes: new Uint8Array() } }]
  };
  const doc: MediaDocument = { containerFormat: "loas", timescale, duration: pts,
    durationSeconds: pts / timescale, byteLength: bytes.length, metadata: {}, tracks: [track] };
  return options.decodeAudio === false ? doc : { ...doc, tracks: [{ ...track,
    decodedAudio: decodeAacTrack(doc, { ...track, samples: aac }) }] };
}
