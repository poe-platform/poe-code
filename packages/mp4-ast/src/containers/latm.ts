import { BitReader, BitWriter, concatBytes } from "../binary.js";
import { MediaBudgetTracker, type MediaAstPlugin, type MediaTrack } from "../types.js";
import { isLoas, parseLoas } from "./loas.js";
import { buildProbeResultFromDoc } from "../mp4.js";

export function latmAst(): MediaAstPlugin {
  return {
    id: "latm", formatName: "loas,latm", formatLongName: "LOAS/LATM",
    extensions: ["latm", "loas"], mimeTypes: ["audio/MP4A-LATM"],
    canDemux: true, canMux: true,
    supportedVideoCodecs: [], supportedAudioCodecs: ["aac", "aac_latm"],
    detect: bytes => isLoas(bytes),
    parse: parseLoas,
    probe(bytes, options) {
      const doc = parseLoas(bytes, { ...options, decodeAudio: false });
      const result = buildProbeResultFromDoc(doc, bytes.length,
        options?.filename ?? "input.latm", { ...options, formatName: "loas", formatLongName: "LOAS AudioSyncStream" });
      return { ...result,
        packetData: new Map(doc.tracks[0]!.samples.map(sample => [`${sample.offset}:${sample.size}`, sample.data])),
        streams: result.streams.map(stream => ({ ...stream, codec_long_name: "AAC LATM (Advanced Audio Coding LATM syntax)" })),
        frames: result.frames?.map(frame => ({ ...frame, nb_samples: 1024,
          duration: frame.pkt_duration!, duration_time: frame.pkt_duration_time! })) };
    },
    serialize(doc, options = {}) {
      const track = doc.tracks[0];
      if (doc.tracks.length !== 1 || track?.type !== "audio") {
        throw new Error("LATM requires exactly one AAC audio stream");
      }
      const packets = serializeLatmPackets(track);
      const budget = options.budget ?? new MediaBudgetTracker(options.limits);
      const size = packets.reduce((total, packet) => total + packet.length, 0);
      budget.checkOutputBytes(size);
      budget.allocateMemory(size);
      return concatBytes(packets);
    }
  };
}

export function serializeLatmPackets(track: MediaTrack): Uint8Array[] {
  const codec = track.codecDescriptions[0];
  if (codec?.codecName === "aac_latm") return track.samples.map(sample => sample.data);
  const asc = codec?.esds?.decoderSpecificInfo;
  if (codec?.codecName !== "aac" || !asc || asc.length < 2) {
    throw new Error("LATM requires AAC AudioSpecificConfig");
  }
  const config = new BitReader(asc);
  const objectType = config.readBits(5);
  const frequencyIndex = config.readBits(4);
  if (frequencyIndex === 15) config.readBits(24);
  const channels = config.readBits(4);
  config.readBit(); // frameLengthFlag
  const dependsOnCoreCoder = config.readBit();
  const extensionFlag = config.readBit();
  if (objectType !== 2 || channels === 0 || channels > 7 ||
      (frequencyIndex > 12 && frequencyIndex !== 15) || dependsOnCoreCoder || extensionFlag ||
      asc.length * 8 < config.bitOffset) {
    throw new Error("LATM requires an AAC-LC configuration without core coder dependencies or extensions");
  }
  return track.samples.map((sample, index) => {
    if (sample.sampleDescriptionIndex > 1) throw new Error("LATM does not support changing AAC configurations");
    const bits = new BitWriter();
    const writeConfig = index % 20 === 0;
    bits.writeBit(writeConfig ? 0 : 1); // useSameStreamMux
    if (writeConfig) {
      bits.writeBit(0); // audioMuxVersion
      bits.writeBit(1); // allStreamsSameTimeFraming
      bits.writeBits(0, 6); // numSubFrames
      bits.writeBits(0, 4); // numProgram
      bits.writeBits(0, 3); // numLayer
      const reader = new BitReader(asc);
      for (let i = 0; i < config.bitOffset; i++) bits.writeBit(reader.readBit());
      bits.writeBits(0, 3); // frameLengthType
      bits.writeBits(255, 8); // latmBufferFullness
      bits.writeBit(0); // otherDataPresent
      bits.writeBit(0); // crcCheckPresent
    }
    const size = sample.data.length;
    // LOAS has a 13-bit AudioMuxElement length, including framing overhead.
    const length = Math.ceil(((writeConfig ? 29 + config.bitOffset : 1) +
      (Math.floor(size / 255) + 1 + size) * 8) / 8);
    if (length > 8191) throw new Error("AAC packet exceeds the LOAS frame size limit");
    for (let remaining = size; remaining >= 255; remaining -= 255) bits.writeBits(255, 8);
    bits.writeBits(size % 255, 8);
    for (const byte of sample.data) bits.writeBits(byte, 8);
    return concatBytes([new Uint8Array([0x56, 0xe0 | (length >>> 8), length & 255]), bits.toUint8Array()]);
  });
}
