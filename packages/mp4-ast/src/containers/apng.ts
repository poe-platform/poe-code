import { apngSteps, blendApngPixels, decodeImage } from "@poe-code/image-ast/portable";
import { concatBytes } from "../binary.js";
import { buildProbeResultFromDoc, concatMp4, sliceMp4 } from "../mp4.js";
import type { MediaAstPlugin, MediaSample, MediaVideoFrame } from "../types.js";

export function apngAst(): MediaAstPlugin {
  return {
    id: "apng", formatName: "apng", formatLongName: "Animated Portable Network Graphics",
    extensions: ["apng"], mimeTypes: ["image/apng"], canDemux: true, canMux: false,
    supportedVideoCodecs: ["apng"], supportedAudioCodecs: [],
    detect(bytes) {
      if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return false;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let offset = 8; offset + 12 <= bytes.length;) {
        const type = view.getUint32(offset + 4);
        if (type === 0x6163544c) return true; // acTL precedes image data.
        if (type === 0x49444154 || type === 0x49454e44) return false;
        offset += view.getUint32(offset) + 12;
      }
      return false;
    },
    parse(bytes, options) {
      const budget = options?.budget;
      const steps = apngSteps(bytes.length);
      let step = steps.next();
      let chunks: Uint8Array[] = [];
      let canvas: Uint8Array = new Uint8Array();
      let width = 0, height = 0, duration = 0;
      const frames: MediaVideoFrame[] = [], samples: MediaSample[] = [];
      while (!step.done) {
        const value = step.value;
        budget?.checkCpu();
        if (value.kind === "read") {
          step = steps.next(bytes.subarray(value.position, value.position + value.length));
          continue;
        }
        if (value.kind === "chunk") {
          chunks.push(value.bytes);
        } else {
          const frame = value.frame;
          width = frame.canvasWidth; height = frame.canvasHeight;
          budget?.recordFrame(width, height);
          budget?.checkSamples(frames.length + 1);
          const size = width * height * 4;
          // Canvas, decoded patch, disposal backup and retained displayed frame.
          budget?.allocateMemory(size * 4);
          if (!canvas.length) {
            budget?.allocateMemory(size);
            canvas = new Uint8Array(size);
          }
          budget?.allocateMemory(chunks.reduce((total, chunk) => total + chunk.length, 0));
          const packet = concatBytes(chunks);
          chunks = [];
          const image = decodeImage(packet);
          const previous = frame.dispose === 2 ? canvas.slice() : undefined;
          for (let y = 0; y < frame.height; y++) {
            const start = ((frame.y + y) * width + frame.x) * 4;
            blendApngPixels(canvas.subarray(start, start + frame.width * 4),
              image.data.subarray(y * frame.width * 4, (y + 1) * frame.width * 4), frame.blend);
          }
          // FFmpeg's default APNG delay for a zero numerator is 1/15 second.
          const ticks = frame.delay > 0 ? Math.round(frame.delay * 1000) : Math.round(1000000 / 15);
          budget?.checkDuration((duration + ticks) / 1000000);
          frames.push({ width, height, data: canvas.slice(), ptsSeconds: duration / 1000000,
            durationSeconds: ticks / 1000000, keyframe: true });
          samples.push({ data: packet, dts: duration, pts: duration, cts: 0, duration: ticks,
            size: packet.length, isKeyframe: true, sampleDescriptionIndex: 1 });
          duration += ticks;
          if (previous) canvas = previous;
          else if (frame.dispose === 1) {
            for (let y = 0; y < frame.height; y++) {
              const start = ((frame.y + y) * width + frame.x) * 4;
              canvas.fill(0, start, start + frame.width * 4);
            }
          }
          budget?.releaseMemory(size * 3);
        }
        step = steps.next(new Uint8Array());
      }
      return {
        containerFormat: "apng", timescale: 1000000, duration, durationSeconds: duration / 1000000,
        tracks: [{ id: 1, type: "video", handlerType: "vide", timescale: 1000000, duration,
          language: "und", enabled: true, width, height,
          codecDescriptions: [{ formatFourCC: "apng", codecName: "apng", width, height, pixFmt: "rgba" }],
          samples, decodedVideoFrames: frames }], metadata: {}, byteLength: bytes.length
      };
    },
    serialize() { throw new Error("APNG output is not supported"); },
    probe(bytes, options) {
      return buildProbeResultFromDoc(this.parse(bytes, options), bytes.length, options?.filename ?? "input.apng", {
        ...options, formatName: "apng", formatLongName: "Animated Portable Network Graphics"
      });
    },
    concat: concatMp4,
    slice: sliceMp4
  };
}
