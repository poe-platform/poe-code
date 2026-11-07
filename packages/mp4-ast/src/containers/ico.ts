import { decodeImage, readImageMetadata } from "@poe-code/image-ast/portable";
import { buildProbeResultFromDoc, concatMp4, sliceMp4 } from "../mp4.js";
import type { MediaAstPlugin, MediaTrack } from "../types.js";

export function icoAst(): MediaAstPlugin {
  return {
    id: "ico", formatName: "ico", formatLongName: "Microsoft Windows ICO",
    extensions: ["ico", "cur"], mimeTypes: ["image/x-icon", "image/vnd.microsoft.icon"],
    canDemux: true, canMux: false, supportedVideoCodecs: ["png", "bmp"], supportedAudioCodecs: [],
    detect(bytes) {
      return bytes.length >= 6 && bytes[0] === 0 && bytes[1] === 0 &&
        (bytes[2] === 1 || bytes[2] === 2) && bytes[3] === 0;
    },
    parse(bytes, options) {
      const metadata = readImageMetadata(bytes), budget = options?.budget;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      budget?.checkStreams(metadata.pages ?? 1);
      budget?.checkSamples(1);
      budget?.checkDuration(0.04);
      const tracks: MediaTrack[] = [];
      for (let page = 0; page < (metadata.pages ?? 1); page++) {
        budget?.checkCpu();
        const { width, height } = readImageMetadata(bytes, { page });
        budget?.recordFrame(width, height);
        budget?.allocateMemory(width * height * 4);
        const image = decodeImage(bytes, { page });
        const entry = 6 + page * 16, offset = view.getUint32(entry + 12, true);
        const packet = bytes.subarray(offset, offset + view.getUint32(entry + 8, true));
        const codecName = packet[0] === 137 ? "png" : "bmp";
        tracks.push({ id: page + 1, type: "video", handlerType: "vide", timescale: 25, duration: 1,
          language: "und", enabled: true, width, height,
          codecDescriptions: [{ formatFourCC: codecName.padEnd(4, " "), codecName, width, height, pixFmt: "rgba" }],
          samples: [{ data: packet, dts: 0, pts: 0, cts: 0, duration: 1, size: packet.length,
            isKeyframe: true, sampleDescriptionIndex: 1 }],
          decodedVideoFrames: [{ width, height, data: image.data, ptsSeconds: 0, durationSeconds: 0.04, keyframe: true }]
        });
      }
      return { containerFormat: "ico", timescale: 25, duration: 1, durationSeconds: 0.04,
        tracks, metadata: {}, byteLength: bytes.length };
    },
    serialize() { throw new Error("ICO output is not supported"); },
    probe(bytes, options) {
      return buildProbeResultFromDoc(this.parse(bytes, options), bytes.length, options?.filename ?? "input.ico", {
        ...options, formatName: "ico", formatLongName: "Microsoft Windows ICO"
      });
    },
    concat: concatMp4,
    slice: sliceMp4
  };
}
