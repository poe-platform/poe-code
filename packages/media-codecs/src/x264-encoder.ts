import createX264EncoderRuntime, { type X264EncoderRuntime } from "../vendor/x264-encoder.js";

export const h264Presets = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow", "placebo"] as const;

let runtime: X264EncoderRuntime | undefined;

/** Encode YUV420 pictures with x264 presets, yielding Annex-B packets in decode order. */
export function* encodeH264Preset(
  frames: Iterable<{ y: Uint8Array; u: Uint8Array; v: Uint8Array; pts: number; keyframe: boolean }>,
  width: number, height: number, timescale: number, frameDuration: number, preset: string, maxBFrames = -1, qp = -1, bitrate = 0, zeroLatency = false
): Generator<{ data: Uint8Array; pts: number; dts: number; keyframe: boolean }> {
  if (!h264Presets.some(name => name === preset)) throw new Error(`invalid preset '${preset}'`);
  if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= 4096 && value % 2 === 0)) {
    throw new Error("H.264 encoding requires even dimensions up to 4096");
  }
  if (![timescale, frameDuration].every(value => Number.isInteger(value) && value > 0 && value <= 2147483647) ||
      !Number.isInteger(maxBFrames) || maxBFrames < -1 || maxBFrames > 2147483647) throw new Error("Invalid H.264 encoder configuration");
  if (!Number.isSafeInteger(bitrate) || bitrate < 0 || bitrate > 2147483647) throw new Error("Invalid H.264 bitrate");
  if (!Number.isInteger(qp) || qp < -1 || qp > 51) throw new Error("H.264 quantizer must be between -1 and 51");
  const module = runtime ??= createX264EncoderRuntime({ printErr() {}, locateFile: () => "embedded-x264-encoder" });
  let encoder = 0;
  let input = 0;
  const size = width * height;
  try {
    input = module._malloc(size * 3 / 2 + 32);
    if (!input) throw new Error("H.264 encoder allocation failed");
    module.HEAPU8.set(new TextEncoder().encode(preset + "\0"), input);
    encoder = module._preset_encoder_create(width, height, timescale, frameDuration, input, maxBFrames, qp, bitrate, Number(zeroLatency));
    if (!encoder) throw new Error("Unable to initialize H.264 preset encoder");
    let sent = 0, received = 0, previousPts = -Infinity;
    for (const frame of frames) {
      if (frame.y.length !== size || frame.u.length !== size / 4 || frame.v.length !== size / 4 ||
          !Number.isSafeInteger(frame.pts) || frame.pts <= previousPts) throw new Error("Invalid H.264 frame planes or timestamp");
      previousPts = frame.pts;
      module.HEAPU8.set(frame.y, input);
      module.HEAPU8.set(frame.u, input + size);
      module.HEAPU8.set(frame.v, input + size * 5 / 4);
      sent++;
      const packet = receive(module._preset_encoder_frame(encoder, input, frame.pts, Number(frame.keyframe)));
      if (packet) { received++; yield packet; }
    }
    while (received < sent) {
      const packet = receive(module._preset_encoder_frame(encoder, 0, 0, 0));
      if (!packet) throw new Error("H.264 encoder did not flush every picture");
      received++;
      yield packet;
    }
  } finally {
    module._free(input);
    module._preset_encoder_free(encoder);
  }

  function receive(pointer: number) {
    if (pointer < 0) throw new Error("H.264 preset encode failed");
    if (!pointer) return undefined;
    const view = new DataView(module.HEAPU8.buffer, pointer, 28);
    const data = view.getUint32(0, true), length = view.getInt32(4, true);
    if (length <= 0 || length > size * 4 + 65536) throw new Error("Invalid H.264 encoded frame size");
    return { data: module.HEAPU8.slice(data, data + length), pts: view.getFloat64(8, true),
      dts: view.getFloat64(16, true), keyframe: view.getInt32(24, true) !== 0 };
  }
}
