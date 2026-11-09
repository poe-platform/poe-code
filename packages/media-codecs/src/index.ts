import createCodecRuntime, { type CodecRuntime } from "../vendor/runtime.js";

export interface VideoPacket {
  readonly data: Uint8Array;
  readonly pts: number;
  readonly dts: number;
  readonly duration: number;
}

export interface NativeVideoPixels {
  readonly rgba: Uint8Array;
  readonly pixels: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly format: number;
  readonly colorspace: number;
  readonly fullRange: number;
}

export interface VideoPicture {
  readonly native?: NativeVideoPixels;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  readonly pts: number;
  readonly duration: number;
}

let runtime: CodecRuntime | undefined;

/** Decode in presentation order, including delayed B frames, without host I/O. */
export function* decodeH264(
  packets: Iterable<VideoPacket>,
  extra: Uint8Array,
  maxPixels: number
): Generator<VideoPicture> {
  if (!Number.isSafeInteger(maxPixels) || maxPixels <= 0) throw new Error("Invalid H.264 pixel limit");
  const module = runtime ??= createCodecRuntime({ printErr() {}, locateFile: () => "embedded-codecs" });
  let decoder = 0;
  let input = 0;
  try {
    if (extra.length) {
      input = module._malloc(extra.length);
      if (!input) throw new Error("H.264 allocation failed");
      module.HEAPU8.set(extra, input);
    }
    decoder = module._decoder_create(input, extra.length, maxPixels);
    module._free(input);
    input = 0;
    if (!decoder) throw new Error("Invalid H.264 decoder configuration");
    for (const packet of packets) {
      if (!packet.data.length) throw new Error("Empty H.264 packet");
      if (![packet.pts, packet.dts, packet.duration].every(Number.isSafeInteger)) throw new Error("Invalid H.264 timestamp");
      input = module._malloc(packet.data.length);
      if (!input) throw new Error("H.264 allocation failed");
      module.HEAPU8.set(packet.data, input);
      const status = module._decoder_send(decoder, input, packet.data.length, packet.pts, packet.dts, packet.duration);
      module._free(input);
      input = 0;
      if (status < 0) throw new Error(`H.264 packet decode failed (${status})`);
      yield* receive();
    }
    const status = module._decoder_send(decoder, 0, 0, 0, 0, 0);
    if (status < 0) throw new Error(`H.264 flush failed (${status})`);
    yield* receive();
  } finally {
    module._free(input);
    module._decoder_free(decoder);
  }

  function* receive(): Generator<VideoPicture> {
    for (;;) {
      const pointer = module._decoder_receive(decoder);
      if (pointer === 0) return;
      if (pointer < 0) throw new Error(`H.264 frame decode failed (${pointer})`);
      const view = new DataView(module.HEAPU8.buffer, pointer, 52);
      const width = view.getInt32(0, true);
      const height = view.getInt32(4, true);
      const data = view.getUint32(8, true);
      const length = view.getInt32(12, true);
      if (width <= 0 || height <= 0 || width * height > maxPixels || length !== width * height * 4) {
        throw new Error("H.264 frame exceeds configured dimensions");
      }
      const rgba = module.HEAPU8.slice(data, data + length);
      const pixels = view.getUint32(32, true);
      const pixelLength = view.getInt32(36, true);
      yield {
        width, height,
        data: rgba,
        native: {
          rgba, pixels: module.HEAPU8.slice(pixels, pixels + pixelLength), width, height,
          format: view.getInt32(40, true), colorspace: view.getInt32(44, true), fullRange: view.getInt32(48, true)
        },
        pts: view.getFloat64(16, true),
        duration: view.getFloat64(24, true)
      };
    }
  }
}

/** Scale original decoded pixels; changed RGBA frames must use the caller's RGB scaler. */
export function scaleVideoPicture(
  frame: { data: Uint8Array; width: number; height: number; native?: NativeVideoPixels },
  width: number, height: number
): Uint8Array | undefined {
  const source = frame.native;
  if (!source || source.rgba !== frame.data || source.width !== frame.width || source.height !== frame.height) return undefined;
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0) || width * height > 33554432) {
    throw new Error("Invalid scaled video dimensions");
  }
  const module = runtime ??= createCodecRuntime({ printErr() {}, locateFile: () => "embedded-codecs" });
  let input = 0;
  let output = 0;
  try {
    input = module._malloc(source.pixels.length + 64);
    output = module._malloc(width * height * 4 + 64);
    if (!input || !output) throw new Error("Video scaling allocation failed");
    module.HEAPU8.set(source.pixels, input);
    module.HEAPU8.fill(0, input + source.pixels.length, input + source.pixels.length + 64);
    const status = module._scale_picture(input, source.pixels.length, source.width, source.height,
      source.format, source.colorspace, source.fullRange, output, width, height);
    if (status < 0) throw new Error(`Video scaling failed (${status})`);
    return module.HEAPU8.slice(output, output + width * height * 4);
  } finally {
    module._free(input);
    module._free(output);
  }
}

export interface EncodedAudioPacket {
  readonly data: Uint8Array;
  readonly granule: number;
}

export interface EncodedAudio {
  readonly headers: readonly Uint8Array[];
  readonly packets: readonly EncodedAudioPacket[];
  readonly sampleRate: number;
  readonly channels: number;
}

/** Encode PCM with libvorbis or libopus, including encoder delay and final trimming. */
export function encodeOggAudio(
  codec: "vorbis" | "opus",
  sampleRate: number,
  channelData: readonly Float32Array[],
  bitrate?: number
): EncodedAudio {
  const channels = channelData.length;
  const count = channelData[0]?.length ?? 0;
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 ||
      channels < 1 || channels > 8 || (codec === "opus" && channels > 2) ||
      count === 0 || channelData.some(channel => channel.length !== count)) {
    throw new Error("Unsupported Ogg PCM dimensions");
  }
  if (codec === "opus" && bitrate !== undefined && bitrate !== 0 &&
      (!Number.isInteger(bitrate) || bitrate < 500 || bitrate > 512000)) {
    throw new Error("Opus bitrate must be between 500 and 512000 bits per second");
  }
  const rate = codec === "opus" ? 48000 : sampleRate;
  const module = runtime ??= createCodecRuntime({ printErr() {}, locateFile: () => "embedded-codecs" });
  const encoder = module._audio_create(codec === "opus" ? 1 : 0, rate, channels, bitrate ?? 0);
  if (!encoder) throw new Error("Unable to initialize Ogg audio encoder");
  let input = 0;
  try {
    const headers: Uint8Array[] = [];
    for (let index = 0; index < (codec === "opus" ? 1 : 3); index++) {
      const pointer = module._audio_header(encoder, index);
      if (!pointer) throw new Error("Missing Ogg codec header");
      headers.push(copyPacket(pointer).data);
    }
    const preSkip = codec === "opus" ? new DataView(headers[0]!.buffer).getUint16(10, true) : 0;
    if (codec === "opus") {
      // Empty vendor and comment list, as permitted by RFC 7845.
      const tags = new Uint8Array(16);
      tags.set(new TextEncoder().encode("OpusTags"));
      headers.push(tags);
    }
    const frames = Math.round(count * rate / sampleRate);
    const block = codec === "opus" ? 960 : 1024;
    input = module._malloc(block * channels * 4);
    if (!input) throw new Error("Ogg PCM allocation failed");
    const packets: EncodedAudioPacket[] = [];
    for (let start = 0; start < frames + preSkip; start += block) {
      const length = codec === "opus" ? block : Math.min(block, frames - start);
      const view = new DataView(module.HEAPU8.buffer, input, block * channels * 4);
      for (let index = 0; index < length; index++) {
        const position = (start + index) * sampleRate / rate;
        const left = Math.floor(position);
        const mix = position - left;
        for (let channel = 0; channel < channels; channel++) {
          const data = channelData[channel]!;
          const sample = left >= count ? 0 : data[left]! * (1 - mix) + data[Math.min(left + 1, count - 1)]! * mix;
          if (!Number.isFinite(sample)) throw new Error("Ogg PCM sample must be finite");
          view.setFloat32((index * channels + channel) * 4, Math.max(-1, Math.min(1, sample)), true);
        }
      }
      if (module._audio_send(encoder, input, length) < 0) throw new Error("Ogg PCM encoding failed");
      receive();
    }
    if (codec === "vorbis") {
      if (module._audio_send(encoder, 0, 0) < 0) throw new Error("Ogg encoder flush failed");
      receive();
    }
    if (!packets.length) throw new Error("Ogg encoder produced no audio packets");
    if (codec === "opus") {
      const last = packets[packets.length - 1]!;
      packets[packets.length - 1] = { ...last, granule: frames + preSkip };
    }
    return { headers, packets, sampleRate: rate, channels };

    function receive(): void {
      for (;;) {
        const pointer = module._audio_receive(encoder);
        if (pointer === 0) return;
        if (pointer < 0) throw new Error("Ogg packet encoding failed");
        packets.push(copyPacket(pointer));
      }
    }
  } finally {
    module._free(input);
    module._audio_free(encoder);
  }

  function copyPacket(pointer: number): EncodedAudioPacket {
    const view = new DataView(module.HEAPU8.buffer, pointer, 16);
    const start = view.getUint32(0, true);
    const length = view.getInt32(4, true);
    if (length <= 0 || start + length > module.HEAPU8.length) throw new Error("Invalid Ogg codec packet");
    return { data: module.HEAPU8.slice(start, start + length), granule: view.getFloat64(8, true) };
  }
}

export interface DecodedAudioFrame {
  readonly sampleRate: number;
  readonly channelData: readonly Float32Array[];
  readonly pts: number;
}

/** Decode audio packets in memory, retaining priming samples for container edits. */
export function* decodeAudio(codec: "AAC" | "MP3" | "Vorbis" | "Opus" | "AMR-WB" | "AMR-NB", packets: Iterable<VideoPacket>, extra: Uint8Array = new Uint8Array()): Generator<DecodedAudioFrame> {
  if ((codec !== "MP3" && codec !== "AMR-WB" && codec !== "AMR-NB" && !extra.length) || (codec === "Opus" && extra.length < 19) || extra.length > 65536) throw new Error(`Invalid ${codec} decoder configuration`);
  const module = runtime ??= createCodecRuntime({ printErr() {}, locateFile: () => "embedded-codecs" });
  let decoded = 0;
  let sent = 0;
  let decoder = 0;
  let input = 0;
  try {
    input = module._malloc(Math.max(1, extra.length));
    if (!input) throw new Error(`${codec} allocation failed`);
    module.HEAPU8.set(extra, input);
    decoder = module._audio_decoder_create(codec === "AAC" ? 0 : codec === "MP3" ? 1 : codec === "Vorbis" ? 2 : codec === "Opus" ? 3 : codec === "AMR-WB" ? 4 : 5, input, extra.length);
    module._free(input);
    input = 0;
    if (!decoder) throw new Error(`Invalid ${codec} decoder configuration`);
    for (const packet of packets) {
      sent++;
      if (!packet.data.length || ![packet.pts, packet.dts, packet.duration].every(Number.isSafeInteger)) {
        throw new Error(`Invalid ${codec} packet`);
      }
      input = module._malloc(packet.data.length);
      if (!input) throw new Error(`${codec} allocation failed`);
      module.HEAPU8.set(packet.data, input);
      const status = module._decoder_send(decoder, input, packet.data.length, packet.pts, packet.dts, packet.duration);
      module._free(input);
      input = 0;
      if (status < 0) throw new Error(`${codec} packet decode failed (${status})`);
      yield* receive();
    }
    if (module._decoder_send(decoder, 0, 0, 0, 0, 0) < 0) throw new Error(`${codec} flush failed`);
    yield* receive();
    if (codec === "AAC" ? decoded < sent : decoded !== sent - (codec === "Vorbis" ? 1 : 0)) throw new Error(`${codec} stream did not decode every access unit`);
  } finally {
    module._free(input);
    module._decoder_free(decoder);
  }

  function* receive(): Generator<DecodedAudioFrame> {
    for (;;) {
      const pointer = module._audio_decoder_receive(decoder);
      if (pointer === 0) return;
      if (pointer < 0) throw new Error(`${codec} frame decode failed (${pointer})`);
      const view = new DataView(module.HEAPU8.buffer, pointer, 24);
      const sampleRate = view.getInt32(0, true);
      const channels = view.getInt32(4, true);
      const count = view.getInt32(8, true);
      const data = view.getUint32(12, true);
      if (sampleRate < 8000 || sampleRate > 192000 || channels < 1 || channels > 8 || count < 1 || count > 8192) {
        throw new Error(`Unsupported ${codec} frame dimensions`);
      }
      const channelData = Array.from({ length: channels }, (_, channel) =>
        new Float32Array(module.HEAPU8.slice(data + channel * count * 4, data + (channel + 1) * count * 4).buffer));
      if (channelData.some(channel => channel.some(sample => !Number.isFinite(sample)))) throw new Error(`Invalid ${codec} PCM sample`);
      decoded++;
      yield { sampleRate, channelData, pts: view.getFloat64(16, true) };
    }
  }
}

/** Encode bounded PCM frames as AAC, MPEG audio or AMR frames. */
export function encodeAudio(
  codec: "aac" | "mp3" | "amr_nb" | "amr_wb", sampleRate: number,
  channelData: readonly (Float32Array | Float64Array)[], bitrate?: number
): { packets: Uint8Array[]; extra: Uint8Array; frameSize: number; delay: number } {
  const count = channelData[0]?.length ?? 0;
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000 ||
      channelData.length < 1 || channelData.length > (codec === "mp3" ? 2 : 8) ||
      count === 0 || count * channelData.length * 4 > 128 * 1024 * 1024 ||
      channelData.some(channel => channel.length !== count)) throw new Error("Unsupported encoder PCM dimensions");
  const module = runtime ??= createCodecRuntime({ printErr() {}, locateFile: () => "embedded-codecs" });
  if (codec === "amr_nb" && (sampleRate !== 8000 || channelData.length !== 1)) {
    throw new Error("AMR-NB encoding requires mono 8000 Hz PCM");
  }
  if (codec === "amr_wb" && (sampleRate !== 16000 || channelData.length !== 1)) {
    throw new Error("AMR-WB encoding requires mono 16000 Hz PCM");
  }
  if (codec === "amr_wb" && bitrate !== undefined &&
      ![6600, 8850, 12650, 14250, 15850, 18250, 19850, 23050, 23850].includes(bitrate)) {
    throw new Error("Unsupported AMR-WB bitrate");
  }
  const encoder = module._audio_encoder_create(codec === "aac" ? 0 : codec === "mp3" ? 1 : codec === "amr_nb" ? 2 : 3,
    sampleRate, channelData.length, bitrate ?? (codec === "amr_wb" ? 23850 : codec === "amr_nb" ? 12200 : 0));
  if (!encoder) throw new Error(`Unable to initialize ${codec} encoder`);
  let input = 0;
  try {
    const config = new DataView(module.HEAPU8.buffer, module._audio_encoder_config(encoder), 16);
    const extra = module.HEAPU8.slice(config.getUint32(0, true), config.getUint32(0, true) + config.getUint32(4, true));
    const frameSize = config.getInt32(8, true), delay = config.getInt32(12, true);
    if (frameSize <= 0 || frameSize > 8192) throw new Error("Invalid audio encoder frame size");
    input = module._malloc(frameSize * channelData.length * 4);
    if (!input) throw new Error("Audio encoder allocation failed");
    const packets: Uint8Array[] = [];
    for (let offset = 0; offset < count; offset += frameSize) {
      const length = Math.min(frameSize, count - offset);
      const view = new Float32Array(module.HEAPU8.buffer, input, length * channelData.length);
      for (let channel = 0; channel < channelData.length; channel++) {
        view.set(channelData[channel]!.subarray(offset, offset + length), channel * length);
      }
      if (view.some(value => !Number.isFinite(value))) throw new Error("PCM samples must be finite");
      if (module._audio_encoder_send(encoder, input, length) < 0) throw new Error("Audio encoding failed");
      receive();
    }
    if (module._audio_encoder_send(encoder, 0, 0) < 0) throw new Error("Audio encoder flush failed");
    receive();
    return { packets, extra, frameSize, delay };

    function receive(): void {
      for (;;) {
        const pointer = module._audio_encoder_receive(encoder);
        if (pointer === 0) return;
        if (pointer < 0) throw new Error(`Audio encoding failed (${pointer})`);
        const view = new DataView(module.HEAPU8.buffer, pointer, 8);
        const data = view.getUint32(0, true), length = view.getUint32(4, true);
        packets.push(module.HEAPU8.slice(data, data + length));
      }
    }
  } finally {
    module._free(input);
    module._decoder_free(encoder);
  }
}
