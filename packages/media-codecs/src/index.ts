import createCodecRuntime, { type CodecRuntime } from "../vendor/runtime.js";

export interface VideoPacket {
  readonly data: Uint8Array;
  readonly pts: number;
  readonly dts: number;
  readonly duration: number;
}

export interface VideoPicture {
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
      const view = new DataView(module.HEAPU8.buffer, pointer, 32);
      const width = view.getInt32(0, true);
      const height = view.getInt32(4, true);
      const data = view.getUint32(8, true);
      const length = view.getInt32(12, true);
      if (width <= 0 || height <= 0 || width * height > maxPixels || length !== width * height * 4) {
        throw new Error("H.264 frame exceeds configured dimensions");
      }
      yield {
        width, height,
        data: module.HEAPU8.slice(data, data + length),
        pts: view.getFloat64(16, true),
        duration: view.getFloat64(24, true)
      };
    }
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
  channelData: readonly Float32Array[]
): EncodedAudio {
  const channels = channelData.length;
  const count = channelData[0]?.length ?? 0;
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 ||
      channels < 1 || channels > 8 || (codec === "opus" && channels > 2) ||
      count === 0 || channelData.some(channel => channel.length !== count)) {
    throw new Error("Unsupported Ogg PCM dimensions");
  }
  const rate = codec === "opus" ? 48000 : sampleRate;
  const module = runtime ??= createCodecRuntime({ printErr() {}, locateFile: () => "embedded-codecs" });
  const encoder = module._audio_create(codec === "opus" ? 1 : 0, rate, channels);
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
