import { MediaBudgetTracker, type MediaSample, type MediaDocument, type MediaAstPlugin, type ParseMediaOptions } from "../types.js";
import { buildProbeResultFromDoc, concatMp4, parseMp4Boxes, sliceMp4 } from "../mp4.js";
import { sampleEntryHeader } from "../mp4-codec-metadata.js";
import { encodeImaQt } from "./aiff-ima-encoder.js";
import { parseImaQt } from "./aiff-ima.js";
import { rawAudioAsts } from "./raw-audio.js";

import { BinaryWriter, BitReader, concatBytes, makeBox } from "../binary.js";
import { decodeAlac } from "../alac-decoder.js";

const raw = rawAudioAsts();
const cafAudio = rawAudioAsts().filter(plugin => plugin.id !== "u8");
const pcm = raw.filter(plugin => plugin.id !== "u8" && !["mulaw", "alaw"].includes(plugin.id));

function parseCaf(bytes: Uint8Array, options: ParseMediaOptions = {}) {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.length);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || view.getUint32(0) !== 0x63616666 || view.getUint16(4) !== 1) {
    throw new Error("Invalid CAF header");
  }
  let sampleRate = 0, channels = 0;
  let framesPerPacket = 0, bytesPerPacket = 0, bytesPerFrame = 0;
  let format: string | undefined;
  let channelLayout: string | undefined;
  let channelMask: number | undefined;
  let data: Uint8Array | undefined;
  let cookie: Uint8Array | undefined, packetTable: Uint8Array | undefined;
  const metadata: { title?: string; artist?: string; encoder?: string } = {};
  for (let offset = 8; offset < bytes.length;) {
    budget.checkCpu();
    if (offset + 12 > bytes.length) {
      // An incomplete trailing header does not invalidate audio already read.
      if (data) break;
      throw new Error("Truncated CAF chunk header");
    }
    const id = view.getUint32(offset), start = offset + 12;
    if (offset === 8 && id !== 0x64657363) throw new Error("CAF description must be the first chunk");
    const length = view.getBigInt64(offset + 4);
    // A data chunk can declare more bytes than remain in a truncated file.
    // Like unknown-length data, consume the available payload through EOF.
    const size = id === 0x64617461 && (length === -1n || length > BigInt(bytes.length - start))
      ? bytes.length - start : Number(length);
    if (size < 0 || !Number.isSafeInteger(size) || size > bytes.length - start) throw new Error("Invalid CAF chunk bounds");
    // The initial description defines the stream; skip later descriptions.
    if (id === 0x64657363 && offset === 8) {
      if (size !== 32) throw new Error("Invalid CAF description");
      // FFmpeg exposes the CAF double as an integer sample rate.
      sampleRate = Math.trunc(view.getFloat64(start));
      const flags = view.getUint32(start + 12);
      channels = view.getUint32(start + 24);
      const bits = view.getUint32(start + 28);
      const encoding = view.getUint32(start + 8);
      if (encoding === 0x616c6163) {
        format = "alac";
      } else if (encoding === 0x696d6134) {
        format = "ima4";
      } else if (encoding === 0x756c6177 || encoding === 0x616c6177) {
        if (flags !== 0 || bits !== 8) throw new Error("Unsupported CAF audio encoding");
        format = encoding === 0x756c6177 ? "mulaw" : "alaw";
      } else {
        // The explicit signed-integer bit (4) does not change LPCM byte order.
        format = `${flags & 1 ? "f" : "s"}${bits}${bits === 8 ? "" : flags & 2 ? "le" : "be"}`;
        if (encoding !== 0x6c70636d || flags > 7 || !pcm.some(plugin => plugin.id === format)) {
          throw new Error("Unsupported CAF audio encoding");
        }
      }
      framesPerPacket = view.getUint32(start + 20);
      bytesPerPacket = view.getUint32(start + 16);
      bytesPerFrame = channels * bits / 8;
      if (format === "ima4" ? (channels < 1 || channels > 65535 || framesPerPacket !== 64 || bytesPerPacket !== 34 * channels)
        : format === "alac" ? framesPerPacket === 0
        : channels < 1 || channels > 65535 ||
          ((format === "mulaw" || format === "alaw") && (!bytesPerPacket || !framesPerPacket)) ||
          (bytesPerPacket !== 0 && framesPerPacket !== 0 && bytesPerPacket !== framesPerPacket * bytesPerFrame)) {
        throw new Error("Unsupported CAF audio encoding");
      }
    } else if (id === 0x6b756b69) {
      cookie = bytes.subarray(start, start + size);
    } else if (id === 0x70616b74) {
      if (size < 24) throw new Error("Invalid CAF packet table header");
      if (view.getBigInt64(start) < 0n) throw new Error("Invalid CAF packet count");
      packetTable = bytes.subarray(start, start + size);
    } else if (id === 0x6368616e && !(data && ["-", "pipe:", "pipe:0"].includes(options.filename ?? ""))) {
      if (size < 12) throw new Error("Invalid CAF channel layout chunk");
      const tag = view.getUint32(start);
      // Core Audio's low 18 bitmap bits match the WAVE speaker positions.
      // A pipe cannot seek back to apply a layout found after the audio data.
      const bitmap = tag === 0x10000 ? view.getUint32(start + 4) : 0;
      let speakers = 0;
      for (let bit = 0; bit < 18; bit++) if (bitmap & (1 << bit)) speakers++;
      channelMask = bitmap > 0 && bitmap < 0x40000 && speakers === channels ? bitmap : undefined;
      const layouts: Record<number, string> = {
        0x00640001: "mono", 0x00650002: "stereo", 0x00730004: "4.0", 0x006c0004: "quad", 0x00840004: "quad(side)"
      };
      channelLayout = (tag & 0xffff) === channels ? layouts[tag] : undefined;
    } else if (id === 0x696e666f) {
      if (size < 4) throw new Error("Invalid CAF info chunk");
      const info = bytes.subarray(start + 4, start + size);
      const decoder = new TextDecoder();
      let cursor = 0;
      for (let entry = 0; entry < view.getUint32(start); entry++) {
        budget.checkCpu();
        const keyEnd = info.indexOf(0, cursor);
        const valueEnd = keyEnd < 0 ? -1 : info.indexOf(0, keyEnd + 1);
        if (valueEnd < 0) throw new Error("Truncated CAF info entry");
        const key = decoder.decode(info.subarray(cursor, keyEnd));
        if (key === "title" || key === "artist" || key === "encoder") {
          metadata[key] = decoder.decode(info.subarray(keyEnd + 1, valueEnd));
        }
        cursor = valueEnd + 1;
      }
    } else if (id === 0x64617461) {
      if (size < 4) throw new Error("Invalid CAF data chunk");
      // Seekable CAF input uses the final data chunk, matching FFmpeg.
      data = bytes.subarray(start + 4, start + size);
    }
    offset = start + size;
  }
  if (!format || !data) throw new Error("Missing CAF description or data");
  if (format === "ima4") {
    if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new Error("Invalid CAF sample rate");
    const doc = parseImaQt(data, channels, sampleRate, data.length / bytesPerPacket, options, budget);
    return { ...doc, containerFormat: "caf", metadata, byteLength: bytes.length,
      tracks: doc.tracks.map(track => ({ ...track,
        codecDescriptions: track.codecDescriptions.map(desc => ({ ...desc, channelLayout })),
        samples: track.samples.map((sample, index) => ({ ...sample,
          offset: data.byteOffset - bytes.byteOffset + index * bytesPerPacket }))
      })) };
  }
  if (format === "alac") {
    // CAF cookies may wrap the ALACSpecificConfig in frma/alac atoms.
    let config = cookie;
    if (config?.length !== 24) {
      config = undefined;
      for (let offset = 0; cookie && offset + 8 <= cookie.length;) {
        const cv = new DataView(cookie.buffer, cookie.byteOffset + offset, cookie.length - offset);
        const size = cv.getUint32(0);
        if (size < 8 || size > cv.byteLength) throw new Error("Invalid CAF ALAC cookie");
        if (cv.getUint32(4) === 0x616c6163 && size === 36) config = cookie.subarray(offset + 12, offset + size);
        offset += size;
      }
    }
    if (!config || config.length !== 24) throw new Error("Missing CAF ALAC configuration");
    const cv = new DataView(config.buffer, config.byteOffset, config.byteLength);
    if (cv.getUint32(0) !== framesPerPacket || config[9] !== channels || cv.getUint32(20) !== sampleRate ||
        !sampleRate || channels < 1 || channels > 2 || ![16, 20, 24, 32].includes(config[5]!)) {
      throw new Error("Invalid CAF ALAC configuration");
    }
    if (!packetTable || packetTable.length < 24) throw new Error("Missing CAF ALAC packet table");
    const pv = new DataView(packetTable.buffer, packetTable.byteOffset, packetTable.byteLength);
    const count = Number(pv.getBigInt64(0));
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid CAF packet count");
    budget.checkStreams(1);
    budget.checkSamples(count);
    const samples: MediaSample[] = [];
    let cursor = 24, offset = 0, duration = 0;
    for (let index = 0; index < count; index++) {
      budget.checkCpu();
      let size = bytesPerPacket;
      if (!size) {
        for (let octets = 0;; octets++) {
          if (cursor >= packetTable.length || octets === 8) throw new Error("Invalid CAF packet size");
          const byte = packetTable[cursor++]!;
          size = size * 128 + (byte & 127);
          if (!Number.isSafeInteger(size)) throw new Error("Invalid CAF packet size");
          if (!(byte & 128)) break;
        }
      }
      if (size < 3 || size > data.length - offset) throw new Error("Invalid CAF packet bounds");
      const packet = data.subarray(offset, offset + size);
      const reader = new BitReader(packet, 19);
      const explicit = reader.readBit();
      reader.readBits(3);
      if (explicit && reader.bitsRemaining < 32) throw new Error("Truncated ALAC frame header");
      const frames = explicit ? reader.readBits(32) : framesPerPacket;
      if (!frames || frames > framesPerPacket) throw new Error("Invalid ALAC frame length");
      samples.push({ data: packet, size, offset: data.byteOffset - bytes.byteOffset + offset,
        dts: duration, pts: duration, cts: 0, duration: frames, isKeyframe: true, sampleDescriptionIndex: 1 });
      duration += frames;
      budget.checkDuration(duration / sampleRate);
      offset += size;
    }
    if (offset !== data.length || cursor !== packetTable.length) throw new Error("Invalid CAF packet table length");
    const entry = new BinaryWriter();
    entry.writeZeros(6); entry.writeU16BE(1); entry.writeZeros(8);
    entry.writeU16BE(channels); entry.writeU16BE(config[5]!); entry.writeZeros(4);
    entry.writeU32BE((Math.min(sampleRate, 65535) * 65536) >>> 0);
    entry.writeBytes(makeBox("alac", concatBytes([new Uint8Array(4), config])));
    const doc: MediaDocument = {
      containerFormat: "caf", timescale: sampleRate, duration, durationSeconds: duration / sampleRate,
      metadata, byteLength: bytes.length,
      tracks: [{ id: 1, type: "audio", handlerType: "soun", timescale: sampleRate, duration,
        language: "und", enabled: true, samples,
        codecDescriptions: [{ codecName: "alac", formatFourCC: "alac", sampleRate, channels,
          bitsPerSample: config[5], channelLayout, rawStsdEntryBytes: makeBox("alac", entry.toUint8Array()) }],
        ...(options.decodeAudio !== false ? { decodedAudio: decodeAlac(samples, config, budget) } : {})
      }]
    };
    return doc;
  }
  const samples: MediaSample[] = [];
  let duration = 0;
  const variablePackets = bytesPerPacket === 0 || framesPerPacket === 0;
  if (variablePackets) {
    if (!packetTable || packetTable.length < 24) throw new Error("Missing CAF packet table");
    const pv = new DataView(packetTable.buffer, packetTable.byteOffset, packetTable.byteLength);
    const count = Number(pv.getBigInt64(0));
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid CAF packet count");
    budget.checkSamples(count);
    let cursor = 24, offset = 0;
    for (let index = 0; index < count; index++) {
      budget.checkCpu();
      const fields = [bytesPerPacket, framesPerPacket];
      for (let field = 0; field < fields.length; field++) {
        if (fields[field]) continue;
        let value = 0;
        for (let octets = 0;; octets++) {
          if (cursor >= packetTable.length || octets === 8) throw new Error("Invalid CAF packet integer");
          const byte = packetTable[cursor++]!;
          value = value * 128 + (byte & 127);
          if (!Number.isSafeInteger(value)) throw new Error("Invalid CAF packet integer");
          if (!(byte & 128)) break;
        }
        fields[field] = value;
      }
      const size = fields[0]!, frames = fields[1]!;
      if (!frames || !size || size > data.length - offset || size !== frames * bytesPerFrame) {
        throw new Error("Invalid CAF packet bounds");
      }
      samples.push({ data: data.subarray(offset, offset + size), size,
        offset: data.byteOffset - bytes.byteOffset + offset,
        dts: duration, pts: duration, cts: 0, duration: frames, isKeyframe: true, sampleDescriptionIndex: 1 });
      offset += size;
      duration += frames;
      budget.checkDuration(duration / sampleRate);
    }
    if (offset !== data.length || cursor !== packetTable.length) throw new Error("Invalid CAF packet table length");
  } else {
    // CAF batches single-frame packets into at most 4096 bytes, aligned to
    // complete frames; multi-frame packets retain their declared boundaries.
    const packetBytes = framesPerPacket === 1
      ? Math.max(1, Math.floor(4096 / bytesPerPacket)) * bytesPerPacket : bytesPerPacket;
    budget.checkSamples(Math.ceil(data.length / packetBytes));
    for (let start = 0; start < data.length; start += packetBytes) {
      budget.checkCpu();
      const packet = data.subarray(start, start + packetBytes);
      const pts = start * framesPerPacket / bytesPerPacket;
      samples.push({
        data: packet, size: packet.length, offset: data.byteOffset - bytes.byteOffset + start,
        dts: pts, pts, cts: 0, duration: Math.floor(packet.length * framesPerPacket / bytesPerPacket),
        isKeyframe: true, sampleDescriptionIndex: 1
      });
    }
    // Without a packet table, FFmpeg estimates duration from the data start
    // through EOF, including trailing chunks. Packets and decoding stay bounded.
    const durationBytes = packetTable ? data.length : bytes.length - (data.byteOffset - bytes.byteOffset);
    duration = Math.round(durationBytes * framesPerPacket / bytesPerPacket);
  }
  if (packetTable && bytesPerPacket && framesPerPacket) {
    const pv = new DataView(packetTable.buffer, packetTable.byteOffset, packetTable.byteLength);
    duration = Number(pv.getBigInt64(0)) * framesPerPacket;
    if (!Number.isSafeInteger(duration) || duration < 0) throw new Error("Invalid CAF packet duration");
  }
  const doc = raw.find(plugin => plugin.id === format)!.parse(data, { ...options, budget, sampleRate, channels });
  budget.checkDuration(duration / sampleRate);
  return { ...doc, duration, durationSeconds: duration / sampleRate,
    metadata: { ...doc.metadata, ...metadata }, containerFormat: "caf", byteLength: bytes.length,
    tracks: doc.tracks.map(track => ({ ...track, duration,
      declaredSampleCount: doc.duration,
      ...(track.decodedAudio && channelMask ? { decodedAudio: { ...track.decodedAudio, channelMask } } : {}),
      codecDescriptions: track.codecDescriptions.map(desc => ({ ...desc, channelLayout })),
      samples
    })) };
}

export function cafAst(): MediaAstPlugin {
  return {
    id: "caf", formatName: "caf", formatLongName: "Apple CAF (Core Audio Format)",
    extensions: ["caf"], mimeTypes: ["audio/x-caf"],
    canDemux: true, canMux: true, supportedVideoCodecs: [],
    supportedAudioCodecs: [...cafAudio.map(plugin => `pcm_${plugin.id}`), "alac", "adpcm_ima_qt"],
    detect: bytes => bytes.length >= 4 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0) === 0x63616666,
    parse: parseCaf,
    probe(bytes, options = {}) {
      const doc = parseCaf(bytes, { ...options, decodeAudio: false });
      let result = buildProbeResultFromDoc(doc, bytes.length, options.filename,
        { ...options, formatName: "caf", formatLongName: "Apple CAF (Core Audio Format)" });
      const track = doc.tracks[0]!;
      const desc = track.codecDescriptions[0]!;
      // Empty PCM has no duration estimate; retain the description's nominal bitrate.
      if (track.duration === 0 && track.samples.length === 0 && desc.codecName.startsWith("pcm_")) {
        const bitRate = String(desc.sampleRate! * desc.channels! * desc.bitsPerSample!);
        result = { ...result,
          streams: result.streams.map(stream => ({ ...stream, duration_ts: undefined, duration: undefined,
            nb_frames: undefined, bit_rate: bitRate })),
          format: { ...result.format!, duration: undefined, bit_rate: bitRate }
        };
      }
      if (options.seekable !== false) return result;
      // Parsing validates the chunks and retains all audio. Only a packet table
      // encountered before data establishes duration for a nonseekable probe.
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let durationKnown = false;
      for (let offset = 8; offset + 12 <= bytes.length;) {
        options.budget?.checkCpu();
        const id = view.getUint32(offset);
        if (id === 0x64617461) break;
        if (id === 0x70616b74) durationKnown = true;
        offset += 12 + Number(view.getBigInt64(offset + 4));
      }
      return { ...result,
        streams: result.streams.map(stream => ({ ...stream,
          duration: durationKnown ? stream.duration : undefined,
          duration_ts: durationKnown ? stream.duration_ts : undefined
        })),
        format: { ...result.format, size: undefined,
          duration: durationKnown ? result.format.duration : undefined,
          bit_rate: durationKnown ? undefined : result.streams[0]?.bit_rate
        }
      };
    },
    serialize(doc, options = {}) {
      const track = doc.tracks.find(track => track.type === "audio");
      if (!track) throw new Error("CAF output requires an audio stream");
      const desc = track.codecDescriptions[0];
      const codec = options.audioCodec === "copy" ? desc?.codecName : options.audioCodec ?? "pcm_s16be";
      const raw = cafAudio.find(plugin => `pcm_${plugin.id}` === codec);
      const alac = codec === "alac" && options.audioCodec === "copy";
      const ima = codec === "adpcm_ima_qt";
      if (!raw && !alac && !ima) throw new Error(`Unsupported CAF audio codec '${codec}'`);
      const sampleRate = track.decodedAudio?.sampleRate ?? desc?.sampleRate ?? 0;
      const channels = track.decodedAudio?.channels ?? desc?.channels ?? 0;
      if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0 || sampleRate > 0xffffffff ||
          !Number.isSafeInteger(channels) || channels <= 0 || channels > 65535) throw new Error("Invalid CAF audio dimensions");
      const budget = options.budget ?? new MediaBudgetTracker(options.limits);
      const chunks: Uint8Array[] = [];
      let framesPerPacket = ima ? 64 : 1;
      if (alac) {
        const entry = desc?.rawStsdEntryBytes;
        const childOffset = entry && sampleEntryHeader("alac", entry.subarray(8)).childOffset;
        const boxes = entry && childOffset !== undefined ? parseMp4Boxes(entry.subarray(8 + childOffset), 0, 0, budget) : [];
        const wave = boxes.find(box => box.type === "wave");
        const config = boxes.find(box => box.type === "alac") ?? (wave && parseMp4Boxes(wave.payload, 0, 0, budget).find(box => box.type === "alac"));
        if (!config || config.payload.length !== 28) throw new Error("Missing CAF ALAC decoder configuration");
        framesPerPacket = new DataView(config.payload.buffer, config.payload.byteOffset).getUint32(4);
        if (!framesPerPacket) throw new Error("Invalid CAF ALAC frame length");
        const cookie = concatBytes([makeBox("frma", new TextEncoder().encode("alac")), makeBox("alac", config.payload)]);
        budget.checkSamples(track.samples.length);
        let validFrames = 0;
        for (const sample of track.samples) {
          budget.checkCpu();
          const frames = sample.duration * sampleRate / track.timescale;
          if (!Number.isSafeInteger(frames) || frames <= 0 || frames > framesPerPacket || sample.size !== sample.data.length || sample.size === 0) {
            throw new Error("Invalid CAF ALAC packet");
          }
          validFrames += frames;
        }
        const remainder = track.samples.length * framesPerPacket - validFrames;
        if (!Number.isSafeInteger(validFrames) || remainder > 0x7fffffff) throw new Error("Invalid CAF ALAC duration");
        const table = new BinaryWriter();
        table.writeU64BE(track.samples.length);
        table.writeU64BE(validFrames);
        table.writeU32BE(0); table.writeU32BE(remainder);
        for (const sample of track.samples) {
          budget.checkCpu();
          let size = sample.data.length;
          const encoded = [size & 127];
          while ((size = Math.floor(size / 128)) > 0) encoded.unshift((size & 127) | 128);
          budget.checkOutputBytes(table.length + encoded.length);
          table.writeBytes(Uint8Array.from(encoded));
        }
        for (const [id, payload] of [["kuki", cookie], ["pakt", table.toUint8Array()]] as const) {
          const chunk = new BinaryWriter();
          chunk.writeBytes(new TextEncoder().encode(id)); chunk.writeU64BE(payload.length); chunk.writeBytes(payload);
          chunks.push(chunk.toUint8Array());
        }
      }
      let data: Uint8Array;
      if (ima && options.audioCodec !== "copy") {
        if (!track.decodedAudio) throw new Error("QuickTime IMA encoding requires decoded audio");
        data = encodeImaQt(track.decodedAudio.channelData, budget);
      } else {
        const dataLength = alac || ima ? track.samples.reduce((sum, sample) => sum + sample.data.length, 0) : 0;
        budget.checkOutputBytes(dataLength);
        data = alac || ima ? concatBytes(track.samples.map(sample => sample.data)) : raw!.serialize(doc, options);
      }
      const companded = raw?.id === "mulaw" || raw?.id === "alaw";
      const bits = alac || ima ? 0 : companded ? 8 : Number.parseInt(raw!.id.slice(1), 10);
      const frameSize = ima ? channels * 34 : channels * bits / 8;
      const metadata = options.metadata ?? doc.metadata;
      const entries: Uint8Array[] = [];
      for (const key of ["title", "artist", "encoder"] as const) {
        const value = metadata[key];
        if (value === undefined) continue;
        if (value.includes("\0")) throw new Error("CAF metadata cannot contain null bytes");
        entries.push(new TextEncoder().encode(`${key}\0${value}\0`));
      }
      const infoSize = entries.length ? 16 + entries.reduce((size, entry) => size + entry.length, 0) : 0;
      // FFmpeg 7.0.2 writes ITU 2/2 for quad, interpreted as quad(side).
      const layoutTags: Record<string, number> = {
        mono: 0x00640001, stereo: 0x00650002, "4.0": 0x00730004, quad: 0x00840004, "quad(side)": 0x00840004
      };
      const layoutTag = layoutTags[desc?.channelLayout ?? ""];
      const chanSize = layoutTag && (layoutTag & 0xffff) === channels ? 24 : 0;
      const extra = concatBytes(chunks);
      budget.checkOutputBytes(68 + infoSize + chanSize + extra.length + data.length);
      const bytes = new Uint8Array(68 + infoSize + chanSize + extra.length + data.length), view = new DataView(bytes.buffer);
      view.setUint32(0, 0x63616666); view.setUint16(4, 1);
      view.setUint32(8, 0x64657363); view.setBigInt64(12, 32n);
      view.setFloat64(20, sampleRate); view.setUint32(28, alac ? 0x616c6163 : ima ? 0x696d6134 : raw?.id === "mulaw" ? 0x756c6177 : raw?.id === "alaw" ? 0x616c6177 : 0x6c70636d);
      view.setUint32(32, (raw?.id.startsWith("f") ? 1 : 0) | (raw?.id.endsWith("le") ? 2 : 0));
      view.setUint32(36, frameSize); view.setUint32(40, framesPerPacket);
      view.setUint32(44, channels); view.setUint32(48, bits);
      if (infoSize) {
        view.setUint32(52, 0x696e666f); view.setBigInt64(56, BigInt(infoSize - 12));
        view.setUint32(64, entries.length);
        let offset = 68;
        for (const entry of entries) { bytes.set(entry, offset); offset += entry.length; }
      }
      if (chanSize) {
        view.setUint32(52 + infoSize, 0x6368616e); view.setBigInt64(56 + infoSize, 12n);
        view.setUint32(64 + infoSize, layoutTag!);
      }
      bytes.set(extra, 52 + infoSize + chanSize);
      view.setUint32(52 + infoSize + chanSize + extra.length, 0x64617461);
      view.setBigInt64(56 + infoSize + chanSize + extra.length, options.seekable === false ? -1n : BigInt(data.length + 4));
      bytes.set(data, 68 + infoSize + chanSize + extra.length);
      return bytes;
    },
    concat: concatMp4, slice: sliceMp4
  };
}
