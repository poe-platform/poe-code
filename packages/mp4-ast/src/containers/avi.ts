import { mpegFrame } from "@poe-code/audio-ast";
import { decodeH264Samples } from "../h264.js";
import {
  BitReader,
  BinaryReader,
  BinaryWriter,
  concatBytes,
  decodeFourCC,
  decodeUtf8,
  encodeUtf8,
  gcd
} from "../binary.js";
import {
  annexBToAvcc,
  avccToAnnexB,
  buildAudioSpecificConfig,
  buildAvcC,
  buildEsdsBox,
  buildH264SpsPps,
  createSilentAacFrame,
  encodeH264IdrFrame,
  parseAudioSpecificConfig,
  parseAvcC,
  parseEsds,
  parseH264Sps
} from "../codecs.js";
import {
  buildProbeResultFromDoc,
  concatMp4,
  sliceMp4
} from "../mp4.js";
import {
  MediaBudgetTracker,
  type MediaAstPlugin,
  type MediaCodecDescription,
  type MediaDocument,
  type MediaProbeResult,
  type MediaSample,
  type MediaTrack,
  type MediaVideoFrame,
  type ParseMediaOptions,
  type SerializeMediaOptions
} from "../types.js";

export function isAviSignature(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 12 &&
    decodeFourCC(bytes, 0) === "RIFF" &&
    decodeFourCC(bytes, 8) === "AVI "
  );
}

export function isFlvSignature(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 9 &&
    bytes[0] === 0x46 && // 'F'
    bytes[1] === 0x4c && // 'L'
    bytes[2] === 0x56 && // 'V'
    bytes[3] === 0x01
  );
}

export function parseAvi(bytes: Uint8Array, options: ParseMediaOptions = {}): MediaDocument {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.byteLength);

  if (!isAviSignature(bytes)) {
    throw new Error("Invalid AVI file: missing RIFF AVI header");
  }

  let microSecPerFrame = 33333;
  let width = 320;
  let height = 240;

  interface AviStreamInfo {
    fccType: string;
    fccHandler: string;
    scale: number;
    rate: number;
    width?: number;
    height?: number;
    compression?: number;
    sarWidth?: number;
    sarHeight?: number;
    topDown?: boolean;
    sampleRate?: number;
    channels?: number;
    bitsPerSample?: number;
    formatTag?: number;
    extradata?: Uint8Array;
    title?: string;
  }

  const streamInfos: AviStreamInfo[] = [];
  const samplesByStream = new Map<number, MediaSample[]>();
  let title: string | undefined;

  function walkChunks(start: number, end: number, listType?: string): void {
    let pos = start;
    while (pos + 8 <= end) {
      const view = new DataView(bytes.buffer, bytes.byteOffset + pos, end - pos);
      const fourcc = decodeFourCC(bytes, pos);
      const chunkSize = view.getUint32(4, true);
      const payloadStart = pos + 8;
      const payloadEnd = Math.min(end, payloadStart + chunkSize);

      if (fourcc === "LIST" && payloadStart + 4 <= payloadEnd) {
        const childType = decodeFourCC(bytes, payloadStart);
        if (childType === "hdrl" || childType === "strl" || childType === "movi" ||
            (childType === "INFO" && listType === undefined)) {
          walkChunks(payloadStart + 4, payloadEnd, childType);
        }
      } else if (listType === "INFO") {
        if (fourcc === "INAM") {
          const payload = bytes.subarray(payloadStart, payloadEnd);
          const terminator = payload.indexOf(0);
          title = decodeUtf8(terminator < 0 ? payload : payload.subarray(0, terminator));
        }
      } else if (fourcc === "avih" && chunkSize >= 40) {
        microSecPerFrame = view.getUint32(8, true) || 33333;
        width = view.getUint32(8 + 32, true) || width;
        height = view.getUint32(8 + 36, true) || height;
      } else if (fourcc === "strh" && chunkSize >= 48) {
        const fccType = decodeFourCC(bytes, payloadStart);
        const fccHandler = decodeFourCC(bytes, payloadStart + 4);
        const scale = view.getUint32(payloadStart - pos + 20, true) || 1;
        const rate = view.getUint32(payloadStart - pos + 24, true) || 30;
        streamInfos.push({ fccType, fccHandler, scale, rate });
      } else if (fourcc === "strn" && listType === "strl") {
        const cur = streamInfos[streamInfos.length - 1];
        if (cur) {
          const payload = bytes.subarray(payloadStart, payloadEnd);
          const terminator = payload.indexOf(0);
          cur.title = decodeUtf8(terminator < 0 ? payload : payload.subarray(0, terminator));
        }
      } else if (fourcc === "vprp" && listType === "strl" && payloadEnd - payloadStart >= 36) {
        const cur = streamInfos[streamInfos.length - 1];
        const aspect = view.getUint32(28, true);
        const frameWidth = view.getUint32(32, true);
        const frameHeight = view.getUint32(36, true);
        const numerator = (aspect >>> 16) * frameHeight;
        const denominator = (aspect & 0xffff) * frameWidth;
        if (cur?.fccType === "vids" && numerator > 0 && denominator > 0) {
          const divisor = gcd(numerator, denominator);
          cur.sarWidth = numerator / divisor;
          cur.sarHeight = denominator / divisor;
        }
      } else if (fourcc === "strf" && streamInfos.length > 0) {
        const cur = streamInfos[streamInfos.length - 1]!;
        if (cur.fccType === "vids" && chunkSize >= 40) {
          cur.width = view.getInt32(payloadStart - pos + 4, true) || width;
          cur.height = Math.abs(view.getInt32(payloadStart - pos + 8, true)) || height;
          cur.topDown = view.getInt32(payloadStart - pos + 8, true) < 0;
          cur.bitsPerSample = view.getUint16(payloadStart - pos + 14, true);
          cur.compression = view.getUint32(payloadStart - pos + 16, true);
          const compFourcc = decodeFourCC(bytes, payloadStart + 16);
          if (compFourcc.trim()) cur.fccHandler = compFourcc;
          if (chunkSize > 40) {
            cur.extradata = bytes.subarray(payloadStart + 40, payloadEnd);
          }
        } else if (cur.fccType === "auds" && chunkSize >= 14) {
          cur.formatTag = view.getUint16(payloadStart - pos + 0, true);
          cur.channels = view.getUint16(payloadStart - pos + 2, true) || 2;
          cur.sampleRate = view.getUint32(payloadStart - pos + 4, true) || 44100;
          cur.bitsPerSample = view.getUint16(payloadStart - pos + 14, true) || 16;
          if (chunkSize > 18) {
            cur.extradata = bytes.subarray(payloadStart + 18, payloadEnd);
          }
        }
      } else if (/^\d\d(dc|db|wb)$/.test(fourcc)) {
        const streamIdx = parseInt(fourcc.slice(0, 2), 10);
        let list = samplesByStream.get(streamIdx);
        if (!list) {
          list = [];
          samplesByStream.set(streamIdx, list);
        }
        const chunkData = bytes.subarray(payloadStart, payloadEnd);
        const idx = list.length;
        list.push({
          data: chunkData,
          dts: idx,
          pts: idx,
          cts: 0,
          duration: 1,
          size: chunkData.byteLength,
          isKeyframe: fourcc.endsWith("db") || idx === 0 || fourcc.endsWith("wb"),
          sampleDescriptionIndex: 1
        });
      }

      pos = payloadEnd + (chunkSize & 1);
    }
  }

  walkChunks(12, bytes.byteLength);

  const tracks: MediaTrack[] = [];
  for (let i = 0; i < streamInfos.length; i++) {
    const info = streamInfos[i]!;
    const metadata = info.title === undefined ? undefined : { title: info.title };
    const rawSamples = samplesByStream.get(i) ?? [];
    if (info.fccType === "vids") {
      const fps = info.rate / Math.max(1, info.scale) || Math.round(1_000_000 / microSecPerFrame);
      const timescale = 90000;
      const frameDur = Math.max(1, Math.round(timescale / Math.max(1, fps)));
      const w = info.width ?? width;
      const h = info.height ?? height;

      if (info.compression === 0) {
        if (info.bitsPerSample !== 24) throw new Error("AVI BI_RGB supports only 24-bit pixels");
        const stride = Math.ceil(w * 3 / 4) * 4;
        const samples: MediaSample[] = [];
        const frames: MediaVideoFrame[] = [];
        for (const [index, sample] of rawSamples.entries()) {
          budget.checkCpu();
          budget.checkSamples(index + 1);
          budget.checkDuration((index + 1) / fps);
          if (sample.data.length === 0) continue;
          if (sample.data.length < stride * h) throw new Error("Truncated AVI BI_RGB frame");
          budget.recordFrame(w, h);
          const data = new Uint8Array(w * h * 4);
          for (let y = 0; y < h; y++) {
            budget.checkCpu();
            const row = (info.topDown ? y : h - 1 - y) * stride;
            for (let x = 0; x < w; x++) {
              const source = row + x * 3;
              const target = (y * w + x) * 4;
              data[target] = sample.data[source + 2]!;
              data[target + 1] = sample.data[source + 1]!;
              data[target + 2] = sample.data[source]!;
              data[target + 3] = 255;
            }
          }
          samples.push({ ...sample, dts: index * frameDur, pts: index * frameDur, duration: frameDur, isKeyframe: true });
          frames.push({ width: w, height: h, data, ptsSeconds: index / fps, durationSeconds: 1 / fps, keyframe: true });
        }
        tracks.push({
          id: i + 1, type: "video", handlerType: "vide", timescale,
          duration: rawSamples.length * frameDur, language: "und", enabled: true,
          width: w, height: h,
          codecDescriptions: [{ formatFourCC: "raw ", codecName: "rawvideo", width: w, height: h, sarWidth: info.sarWidth, sarHeight: info.sarHeight, pixFmt: "bgr24" }],
          samples, decodedVideoFrames: frames, metadata
        });
        continue;
      }

      const isFlv1 = info.fccHandler.toUpperCase() === "FLV1";
      let allSps: Uint8Array[] = [];
      let allPps: Uint8Array[] = [];
      const directAvcC = !isFlv1 && info.extradata && info.extradata.byteLength >= 7 && info.extradata[0] === 1
        ? parseAvcC(info.extradata)
        : undefined;
      if (!isFlv1 && !directAvcC && info.extradata && info.extradata.byteLength >= 4) {
        const extConv = annexBToAvcc(info.extradata);
        if (extConv.sps.length > 0) allSps = extConv.sps;
        if (extConv.pps.length > 0) allPps = extConv.pps;
      }

      const isAnnexB = (buf: Uint8Array): boolean =>
        buf.byteLength >= 4 &&
        ((buf[0] === 0 && buf[1] === 0 && buf[2] === 0 && buf[3] === 1) ||
          (buf[0] === 0 && buf[1] === 0 && buf[2] === 1));

      const hasIdrInAvcc = (buf: Uint8Array): boolean => {
        let off = 0;
        while (off + 4 <= buf.byteLength) {
          const len = ((buf[off]! << 24) | (buf[off + 1]! << 16) | (buf[off + 2]! << 8) | buf[off + 3]!) >>> 0;
          if (len === 0 || off + 4 + len > buf.byteLength) break;
          const nalType = buf[off + 4]! & 0x1f;
          if (nalType === 5) return true;
          off += 4 + len;
        }
        return false;
      };

      const convertedSamples: MediaSample[] = [];
      let curDts = 0;
      for (let sIdx = 0; sIdx < rawSamples.length; sIdx++) {
        const s = rawSamples[sIdx]!;
        if (s.data.byteLength === 0) {
          if (convertedSamples.length > 0) {
            const prev = convertedSamples[convertedSamples.length - 1]!;
            convertedSamples[convertedSamples.length - 1] = { ...prev, duration: prev.duration + frameDur };
            curDts += frameDur;
          }
          continue;
        }
        let data = s.data;
        let isKey = s.isKeyframe || convertedSamples.length === 0;
        if (!isFlv1 && isAnnexB(s.data)) {
          const conv = annexBToAvcc(s.data);
          if (conv.sps.length > 0) allSps = conv.sps;
          if (conv.pps.length > 0) allPps = conv.pps;
          if (conv.avccData.byteLength > 0) data = conv.avccData;
          if (conv.isKeyframe) isKey = true;
        } else {
          if (!isFlv1 && hasIdrInAvcc(data)) isKey = true;
        }
        if (data.byteLength === 0) continue;
        convertedSamples.push({
          data,
          dts: curDts,
          pts: curDts,
          cts: 0,
          duration: frameDur,
          size: data.byteLength,
          isKeyframe: isKey,
          sampleDescriptionIndex: 1
        });
        curDts += frameDur;
      }

      if (!isFlv1 && !directAvcC && allSps.length === 0) {
        const gen = buildH264SpsPps(w, h, fps);
        allSps = [gen.sps];
        allPps = [gen.pps];
      }

      const avcC = isFlv1 ? undefined : directAvcC ?? parseAvcC(buildAvcC(allSps, allPps));
      const fccUpper = info.fccHandler.toUpperCase();
      const codecName = isFlv1 ? "flv1" :
        fccUpper.includes("MJPG") || fccUpper.includes("JPEG")
          ? "mjpeg"
          : fccUpper.includes("FMP4") || fccUpper.includes("XVID")
            ? "mpeg4"
            : "h264";

      tracks.push({
        id: i + 1,
        type: "video",
        handlerType: "vide",
        timescale,
        duration: curDts,
        language: "und",
        enabled: true,
        width: w,
        height: h,
        codecDescriptions: [
          {
            formatFourCC: isFlv1 ? "FLV1" : codecName === "mjpeg" ? "jpeg" : "avc1",
            codecName,
            width: w,
            height: h,
            sarWidth: info.sarWidth,
            sarHeight: info.sarHeight,
            pixFmt: "yuv420p",
            avcC
          }
        ],
        samples: convertedSamples,
        metadata,
        decodedVideoFrames: options.decodeFrames && !isFlv1
          ? [...decodeH264Samples(convertedSamples, [{ formatFourCC: "avc1", codecName: "h264", avcC }], w, h, timescale)]
          : undefined
      });
    } else if (info.fccType === "auds") {
      const sampleRate = info.sampleRate ?? 44100;
      const channels = info.channels ?? 2;
      const codecName =
        info.formatTag === 0x0055
          ? "mp3"
          : info.formatTag === 0x00ff
            ? "aac"
            : "pcm_s16le";
      const nonEmptyAudio = rawSamples.filter((s) => s.data.byteLength > 0);
      const samples = nonEmptyAudio.map((s, idx) => {
        let payload = s.data;
        if (
          codecName === "aac" &&
          payload.byteLength > 7 &&
          payload[0] === 0xff &&
          (payload[1]! & 0xf0) === 0xf0
        ) {
          const hdrLen = (payload[1]! & 0x01) === 0 ? 9 : 7;
          if (payload.byteLength > hdrLen) payload = payload.subarray(hdrLen);
        }
        return {
          ...s,
          data: payload,
          size: payload.byteLength,
          dts: idx * 1024,
          pts: idx * 1024,
          duration: 1024
        };
      });
      tracks.push({
        id: i + 1,
        type: "audio",
        handlerType: "soun",
        timescale: sampleRate,
        duration: samples.length * 1024,
        language: "und",
        enabled: true,
        codecDescriptions: [
          {
            formatFourCC: codecName === "aac" ? "mp4a" : codecName === "mp3" ? ".mp3" : "sowt",
            codecName,
            sampleRate,
            channels,
            bitsPerSample: info.bitsPerSample ?? 16
          }
        ],
        samples,
        metadata
      });
    }
  }

  let maxSec = 0;
  for (const t of tracks) {
    const sec = t.duration / Math.max(1, t.timescale);
    if (sec > maxSec) maxSec = sec;
  }

  return {
    containerFormat: "avi",
    timescale: 1000,
    duration: Math.round(maxSec * 1000),
    durationSeconds: maxSec,
    tracks,
    metadata: title === undefined ? {} : { title },
    byteLength: bytes.byteLength
  };
}

function makeRiffChunk(fourcc: string, payload: Uint8Array): Uint8Array {
  const pad = payload.byteLength & 1;
  const out = new Uint8Array(8 + payload.byteLength + pad);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = fourcc.charCodeAt(i) & 0xff;
  view.setUint32(4, payload.byteLength, true);
  out.set(payload, 8);
  return out;
}

function makeRiffList(listType: string, children: readonly Uint8Array[]): Uint8Array {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) typeBytes[i] = listType.charCodeAt(i) & 0xff;
  const body = concatBytes([typeBytes, ...children]);
  return makeRiffChunk("LIST", body);
}

export function serializeAvi(doc: MediaDocument, options: SerializeMediaOptions = {}): Uint8Array {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  const tracks = doc.tracks.filter((track) => track.type === "video" || track.type === "audio");
  if (tracks.length > 100) throw new Error("AVI supports at most 100 streams");
  const videoTrack = tracks.find((track) => track.type === "video");
  const width = videoTrack?.width ?? 320;
  const height = videoTrack?.height ?? 240;
  let frameCount = videoTrack?.samples.length || videoTrack?.decodedVideoFrames?.length || 0;
  let fps = frameCount > 0 && videoTrack && videoTrack.duration > 0 && videoTrack.timescale > 0
    ? frameCount * videoTrack.timescale / videoTrack.duration : 30;

  const strlLists: Uint8Array[] = [];
  const moviChunks: Uint8Array[] = [];
  const idx1Writer = new BinaryWriter();
  let moviOffset = 4;

  for (const [streamIndex, track] of tracks.entries()) {
    const desc = track.codecDescriptions[0];
    const strh = new BinaryWriter(56);
    const strf = new BinaryWriter();
    const vprp = new BinaryWriter();
    let samples = track.samples;
    let payloads: Uint8Array[];
    let slotTicks = 0;
    let slotCount = samples.length;
    const chunkId = `${String(streamIndex).padStart(2, "0")}${track.type === "video" ? "dc" : "wb"}`;

    if (track.type === "video") {
      const w = track.width ?? 320;
      const h = track.height ?? 240;
      if (samples.length === 0 && track.decodedVideoFrames?.length) {
        samples = track.decodedVideoFrames.map((frame, index) => {
          const data = encodeH264IdrFrame(frame.data, w, h, index);
          return { data, dts: index * 3000, pts: index * 3000, cts: 0,
            duration: 3000, size: data.byteLength, isKeyframe: true, sampleDescriptionIndex: 1 };
        });
      }
      const timed = samples.length > 0 && track.duration > 0 && track.timescale > 0;
      // AVI advances one clock tick per chunk, including empty dropped-frame chunks.
      slotTicks = timed ? samples.reduce((ticks, sample) =>
        gcd(gcd(ticks, sample.duration), sample.dts - samples[0]!.dts), track.duration) : 0;
      const ticks = timed ? Math.max(1, slotTicks) : 1;
      const frames = timed ? track.timescale : Math.max(1, Math.round(fps));
      slotTicks = timed ? ticks : 0;
      slotCount = timed ? Math.max(samples.length, Math.ceil(track.duration / ticks)) : samples.length;
      budget.checkSamples(slotCount);
      const divisor = gcd(frames, ticks);
      const rate = frames / divisor;
      const scale = ticks / divisor;
      if (track === videoTrack) {
        fps = rate / scale;
        frameCount = slotCount;
      }
      const codec = desc?.codecName === "mjpeg" ? "MJPG" : desc?.codecName === "mpeg4" ? "FMP4" : "H264";
      strh.writeFourCC("vids");
      strh.writeFourCC(codec);
      strh.writeU32LE(0);
      strh.writeU16LE(0);
      strh.writeU16LE(0);
      strh.writeU32LE(0);
      strh.writeU32LE(scale);
      strh.writeU32LE(rate);
      strh.writeU32LE(0);
      strh.writeU32LE(slotCount);
      strh.writeU32LE(w * h * 3);
      strh.writeU32LE(0xffffffff);
      strh.writeU32LE(0);
      strh.writeU16LE(0);
      strh.writeU16LE(0);
      strh.writeU16LE(w);
      strh.writeU16LE(h);

      strf.writeU32LE(40);
      strf.writeI32LE(w);
      strf.writeI32LE(h);
      strf.writeU16LE(1);
      strf.writeU16LE(24);
      strf.writeFourCC(codec);
      strf.writeU32LE(w * h * 3);
      strf.writeZeros(16);

      if (desc?.sarWidth && desc.sarHeight) {
        const numerator = w * desc.sarWidth;
        const denominator = h * desc.sarHeight;
        const divisor = gcd(numerator, denominator);
        // vprp packs the display ratio into two unsigned 16-bit fields.
        const factor = Math.max(1, numerator / divisor / 65535, denominator / divisor / 65535);
        const darWidth = Math.max(1, Math.round(numerator / divisor / factor));
        const darHeight = Math.max(1, Math.round(denominator / divisor / factor));
        vprp.writeU32LE(0); // Video format token
        vprp.writeU32LE(0); // Video standard
        vprp.writeU32LE(Math.round(rate / scale));
        vprp.writeU32LE(w);
        vprp.writeU32LE(h);
        vprp.writeU32LE(darWidth * 65536 + darHeight);
        vprp.writeU32LE(w);
        vprp.writeU32LE(h);
        vprp.writeU32LE(1); // One progressive field
        vprp.writeU32LE(h);
        vprp.writeU32LE(w);
        vprp.writeU32LE(h);
        vprp.writeU32LE(w);
        vprp.writeZeros(16); // Field offsets
      }

      if (codec === "H264") {
        const { sps, pps } = buildH264SpsPps(w, h, rate / scale);
        const spsList = desc?.avcC?.sps.length ? desc.avcC.sps : [sps];
        const ppsList = desc?.avcC?.pps.length ? desc.avcC.pps : [pps];
        const lengthSize = (desc?.avcC?.lengthSizeMinusOne ?? 3) + 1;
        payloads = samples.map((sample, index) => avccToAnnexB(sample.data, lengthSize,
          sample.isKeyframe || index === 0 ? { sps: spsList, pps: ppsList } : undefined));
      } else {
        payloads = samples.map(sample => sample.data);
      }
    } else {
      const sr = desc?.sampleRate ?? 44100;
      const ch = desc?.channels ?? 2;
      const pcm = desc?.codecName === "pcm_s16le";
      const bits = desc?.bitsPerSample ?? 16;
      const blockAlign = pcm ? ch * bits / 8 : 4;
      if (samples.length === 0 && !pcm) {
        const data = createSilentAacFrame(ch);
        samples = [{ data, dts: 0, pts: 0, cts: 0, duration: 1024,
          size: data.byteLength, isKeyframe: true, sampleDescriptionIndex: 1 }];
      }
      const byteLength = samples.reduce((total, sample) => total + sample.data.byteLength, 0);
      strh.writeFourCC("auds");
      strh.writeU32LE(0);
      strh.writeU32LE(0);
      strh.writeU16LE(0);
      strh.writeU16LE(0);
      strh.writeU32LE(0);
      strh.writeU32LE(pcm ? blockAlign : 1024);
      strh.writeU32LE(pcm ? sr * blockAlign : sr);
      strh.writeU32LE(0);
      strh.writeU32LE(pcm ? byteLength / blockAlign : samples.length);
      strh.writeU32LE(4096);
      strh.writeU32LE(0xffffffff);
      strh.writeU32LE(pcm ? blockAlign : 0);
      strh.writeZeros(8);

      strf.writeU16LE(pcm ? 0x0001 : desc?.codecName === "mp3" ? 0x0055 : 0x00ff);
      strf.writeU16LE(ch);
      strf.writeU32LE(sr);
      strf.writeU32LE(pcm ? sr * blockAlign : 16000);
      strf.writeU16LE(blockAlign);
      strf.writeU16LE(bits);
      strf.writeU16LE(0);
      payloads = samples.map(sample => sample.data);
      slotCount = samples.length;
    }

    strlLists.push(makeRiffList("strl", [
      makeRiffChunk("strh", strh.toUint8Array()),
      makeRiffChunk("strf", strf.toUint8Array()),
      ...(vprp.toUint8Array().length ? [makeRiffChunk("vprp", vprp.toUint8Array())] : [])
    ]));
    let sampleIndex = 0;
    for (let slot = 0; slot < slotCount; slot++) {
      const sample = samples[sampleIndex];
      const occupied = sample !== undefined && (slotTicks === 0 ||
        slot >= Math.round((sample.dts - samples[0]!.dts) / slotTicks));
      const data = occupied ? payloads[sampleIndex++]! : new Uint8Array(0);
      const chunk = makeRiffChunk(chunkId, data);
      moviChunks.push(chunk);
      idx1Writer.writeFourCC(chunkId);
      idx1Writer.writeU32LE(occupied && sample.isKeyframe ? 0x10 : 0x00);
      idx1Writer.writeU32LE(moviOffset);
      idx1Writer.writeU32LE(data.byteLength);
      moviOffset += chunk.byteLength;
    }
  }

  const avih = new BinaryWriter(56);
  avih.writeU32LE(Math.round(1_000_000 / fps));
  avih.writeU32LE(100000);
  avih.writeU32LE(0);
  avih.writeU32LE(0x10); // AVIF_HASINDEX
  avih.writeU32LE(frameCount);
  avih.writeU32LE(0);
  avih.writeU32LE(tracks.length);
  avih.writeU32LE(width * height * 3);
  avih.writeU32LE(width);
  avih.writeU32LE(height);
  avih.writeZeros(16);

  const hdrlList = makeRiffList("hdrl", [
    makeRiffChunk("avih", avih.toUint8Array()),
    ...strlLists
  ]);

  const moviList = makeRiffList("movi", moviChunks);
  const idx1Chunk = makeRiffChunk("idx1", idx1Writer.toUint8Array());

  const riffBody = concatBytes([
    encodeUtf8("AVI "),
    hdrlList,
    ...(doc.metadata.title === undefined ? [] : [makeRiffList("INFO", [
      makeRiffChunk("INAM", encodeUtf8(`${doc.metadata.title}\0`))
    ])]),
    moviList,
    idx1Chunk
  ]);
  return makeRiffChunk("RIFF", riffBody);
}

export function probeAvi(
  bytes: Uint8Array,
  options: ParseMediaOptions & { showPackets?: boolean; showFrames?: boolean } = {}
): MediaProbeResult {
  const doc = parseAvi(bytes, options);
  return buildProbeResultFromDoc(doc, bytes.byteLength, options.filename ?? "input.avi", {
    ...options,
    formatName: "avi",
    formatLongName: "AVI (Audio Video Interleaved)"
  });
}

export function aviAst(): MediaAstPlugin {
  return {
    id: "avi",
    formatName: "avi",
    formatLongName: "AVI (Audio Video Interleaved)",
    extensions: ["avi"],
    mimeTypes: ["video/x-msvideo"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: ["h264", "mpeg4", "mjpeg", "rawvideo"],
    supportedAudioCodecs: ["mp3", "aac", "pcm_s16le"],
    detect(bytes, filename) {
      if (isAviSignature(bytes)) return true;
      if (filename && filename.toLowerCase().endsWith(".avi") && bytes.byteLength >= 12) {
        return isAviSignature(bytes);
      }
      return false;
    },
    parse(bytes, options) {
      return parseAvi(bytes, options);
    },
    serialize(doc, options) {
      return serializeAvi(doc, options);
    },
    probe(bytes, options) {
      return probeAvi(bytes, options);
    },
    concat(docs, options) {
      return concatMp4(docs, options);
    },
    slice(doc, options) {
      return sliceMp4(doc, options);
    }
  };
}

// --- FLV (Flash Video) Container ---

function readFlvTitle(bytes: Uint8Array): string | undefined {
  const reader = new BinaryReader(bytes);
  let title: string | undefined;
  const readValue = (depth: number): string | undefined => {
    if (reader.eof || depth > 32) {
      reader.seek(bytes.length);
      return undefined;
    }
    const type = reader.readU8();
    if (type === 2 || type === 12) {
      const length = type === 2 ? reader.readU16BE() : reader.readU32BE();
      if (length > reader.remaining) {
        reader.seek(bytes.length);
        return undefined;
      }
      return decodeUtf8(reader.readSlice(length));
    }
    if (type === 0) reader.skip(8); // number
    else if (type === 1) reader.skip(1); // boolean
    else if (type === 11) reader.skip(10); // date and timezone
    else if (type === 3 || type === 8) {
      if (type === 8) reader.skip(4); // ECMA array count; object end is authoritative
      while (reader.remaining >= 3) {
        const length = reader.readU16BE();
        if (length === 0 && reader.bytes[reader.offset] === 9) {
          reader.skip(1);
          break;
        }
        if (length > reader.remaining) break;
        const key = decodeUtf8(reader.readSlice(length));
        const value = readValue(depth + 1);
        if (depth === 0 && key === "title" && value !== undefined) title = value;
      }
    } else if (type === 10) {
      const count = reader.readU32BE();
      for (let i = 0; i < count && !reader.eof; i++) readValue(depth + 1);
    } else if (type !== 5 && type !== 6) {
      // Unsupported AMF values must not be mistaken for subsequent properties.
      reader.seek(bytes.length);
    }
    return undefined;
  };
  if (readValue(0) !== "onMetaData") return undefined;
  readValue(0);
  return title;
}

export function parseFlv(bytes: Uint8Array, options: ParseMediaOptions = {}): MediaDocument {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.byteLength);

  if (!isFlvSignature(bytes)) {
    throw new Error("Invalid FLV file: missing FLV header signature");
  }

  const reader = new BinaryReader(bytes);
  reader.skip(4); // 'FLV\x01'
  reader.readU8(); // flags
  const dataOffset = reader.readU32BE();
  reader.seek(dataOffset + 4); // skip PreviousTagSize0

  let avcC: ReturnType<typeof parseAvcC> | undefined;
  let isFlv1 = false;
  let audioDescription: MediaCodecDescription = {
    formatFourCC: "mp4a", codecName: "aac", sampleRate: 44100, channels: 2, bitsPerSample: 16
  };
  const videoSamples: MediaSample[] = [];
  const audioSamples: MediaSample[] = [];
  let width = 320;
  let height = 240;
  let title: string | undefined;

  while (reader.remaining >= 11) {
    const tagType = reader.readU8();
    const dataSize = reader.readU24BE();
    const tsLow = reader.readU24BE();
    const tsHigh = reader.readU8();
    const timestampMs = ((tsHigh << 24) | tsLow) >>> 0;
    reader.skip(3); // StreamID

    const tagData = reader.readSlice(dataSize);
    reader.skip(4); // PreviousTagSizeN

    if (tagType === 18) {
      title = readFlvTitle(tagData) ?? title;
    } else if (tagType === 9 && tagData.byteLength >= 2) {
      // Video tag
      const frameAndCodec = tagData[0]!;
      const frameType = (frameAndCodec >>> 4) & 0x0f;
      const codecId = frameAndCodec & 0x0f;
      if (codecId === 2 && frameType !== 5) {
        isFlv1 = true;
        const payload = tagData.subarray(1);
        if (videoSamples.length === 0) {
          // Sorenson Spark picture header: start code, version, timestamp, size.
          const bits = new BitReader(payload);
          if (bits.bitsRemaining < 33 || bits.readBits(17) !== 1) {
            throw new Error("Invalid FLV1 picture header");
          }
          bits.readBits(5);
          bits.readBits(8);
          const sizeCode = bits.readBits(3);
          if (sizeCode < 2) {
            const sizeBits = sizeCode === 0 ? 8 : 16;
            if (bits.bitsRemaining < sizeBits * 2) throw new Error("Truncated FLV1 picture size");
            width = bits.readBits(sizeBits);
            height = bits.readBits(sizeBits);
          } else {
            const size = ([[352, 288], [176, 144], [128, 96], [320, 240], [160, 120]] as const)[sizeCode - 2];
            if (!size) throw new Error("Invalid FLV1 picture size");
            [width, height] = size;
          }
        }
        videoSamples.push({
          data: payload, dts: timestampMs, pts: timestampMs, cts: 0,
          duration: 33, size: payload.byteLength, isKeyframe: frameType === 1,
          sampleDescriptionIndex: 1
        });
      } else if (codecId === 7 && tagData.byteLength >= 5) {
        // AVC
        const avcPacketType = tagData[1]!;
        const ctsMs =
          ((tagData[2]! << 24) >> 8) | (tagData[3]! << 8) | tagData[4]!;
        const payload = tagData.subarray(5);
        if (avcPacketType === 0 && payload.byteLength >= 7) {
          avcC = parseAvcC(payload);
          if (avcC.sps[0]) {
            const sps = parseH264Sps(avcC.sps[0]);
            width = sps.width || width;
            height = sps.height || height;
          }
        } else if (avcPacketType === 1 && payload.byteLength > 0) {
          videoSamples.push({
            data: payload,
            dts: timestampMs,
            pts: timestampMs + ctsMs,
            cts: ctsMs,
            duration: 33,
            size: payload.byteLength,
            isKeyframe: frameType === 1,
            sampleDescriptionIndex: 1
          });
        }
      }
    } else if (tagType === 8 && tagData.byteLength >= 2) {
      // Audio tag
      const soundFormat = (tagData[0]! >>> 4) & 0x0f;
      if (soundFormat === 10) {
        // AAC
        const aacPacketType = tagData[1]!;
        const payload = tagData.subarray(2);
        if (aacPacketType === 0 && payload.byteLength >= 2) {
          const asc = parseAudioSpecificConfig(payload);
          audioDescription = {
            ...audioDescription, sampleRate: asc.sampleRate, channels: asc.channelCount,
            esds: parseEsds(buildEsdsBox(asc.sampleRate, asc.channelCount, 0, payload).subarray(8))
          };
        } else if (aacPacketType === 1 && payload.byteLength > 0) {
          audioSamples.push({
            data: payload,
            dts: timestampMs,
            pts: timestampMs,
            cts: 0,
            duration: 23,
            size: payload.byteLength,
            isKeyframe: true,
            sampleDescriptionIndex: 1
          });
        }
      } else if ((soundFormat === 2 || soundFormat === 14) && tagData.byteLength >= 5) {
        const payload = tagData.subarray(1);
        const header = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0);
        const frame = mpegFrame(header, 0, payload.byteLength);
        audioDescription = {
          formatFourCC: ".mp3", codecName: "mp3", sampleRate: frame.rate,
          channels: frame.channels, bitsPerSample: 16
        };
        audioSamples.push({
          data: payload, dts: timestampMs, pts: timestampMs, cts: 0,
          duration: frame.count / frame.rate * 1000, size: payload.byteLength,
          isKeyframe: true, sampleDescriptionIndex: 1
        });
      }
    }
  }

  for (let i = 0; i < videoSamples.length; i++) {
    const next = videoSamples[i + 1];
    const dur = next ? Math.max(1, next.dts - videoSamples[i]!.dts) : 33;
    videoSamples[i] = { ...videoSamples[i]!, duration: dur };
  }

  const tracks: MediaTrack[] = [];
  if (videoSamples.length > 0 || avcC) {
    const totalDur = videoSamples.reduce((acc, s) => acc + s.duration, 0);
    tracks.push({
      id: 1,
      type: "video",
      handlerType: "vide",
      timescale: 1000,
      duration: totalDur,
      language: "und",
      enabled: true,
      width,
      height,
      codecDescriptions: [
        {
          formatFourCC: isFlv1 ? "FLV1" : "avc1",
          codecName: isFlv1 ? "flv1" : "h264",
          width,
          height,
          pixFmt: "yuv420p",
          avcC
        }
      ],
      samples: videoSamples,
      decodedVideoFrames: options.decodeFrames && !isFlv1
        ? [...decodeH264Samples(videoSamples, [{ formatFourCC: "avc1", codecName: "h264", avcC }], width, height, 1000)]
        : undefined
    });
  }

  if (audioSamples.length > 0) {
    const totalDur = audioSamples.reduce((acc, s) => acc + s.duration, 0);
    tracks.push({
      id: tracks.length + 1,
      type: "audio",
      handlerType: "soun",
      timescale: 1000,
      duration: totalDur,
      language: "und",
      enabled: true,
      codecDescriptions: [audioDescription],
      samples: audioSamples
    });
  }

  let maxSec = 0;
  for (const t of tracks) {
    const sec = t.duration / Math.max(1, t.timescale);
    if (sec > maxSec) maxSec = sec;
  }

  return {
    containerFormat: "flv",
    timescale: 1000,
    duration: Math.round(maxSec * 1000),
    durationSeconds: maxSec,
    tracks,
    metadata: title === undefined ? {} : { title },
    byteLength: bytes.byteLength
  };
}

export function serializeFlv(doc: MediaDocument, options: SerializeMediaOptions = {}): Uint8Array {
  const videoTrack = doc.tracks.find((t) => t.type === "video");
  const audioTrack = doc.tracks.find((t) => t.type === "audio");

  const writer = new BinaryWriter(4096);
  // FLV Header
  writer.writeU8(0x46); // 'F'
  writer.writeU8(0x4c); // 'L'
  writer.writeU8(0x56); // 'V'
  writer.writeU8(0x01); // version 1
  writer.writeU8((videoTrack ? 0x01 : 0x00) | (audioTrack ? 0x04 : 0x00));
  writer.writeU32BE(9); // DataOffset = 9
  writer.writeU32BE(0); // PreviousTagSize0 = 0

  const writeFlvTag = (tagType: number, timestampMs: number, payload: Uint8Array) => {
    const ts = Math.max(0, Math.round(timestampMs));
    writer.writeU8(tagType);
    writer.writeU24BE(payload.byteLength);
    writer.writeU24BE(ts & 0xffffff);
    writer.writeU8((ts >>> 24) & 0xff);
    writer.writeU24BE(0); // StreamID = 0
    writer.writeBytes(payload);
    writer.writeU32BE(11 + payload.byteLength);
  };

  const title = options.metadata?.title ?? doc.metadata.title;
  if (title !== undefined) {
    const payload = new BinaryWriter();
    payload.writeU8(2); // AMF string
    payload.writeU16BE(10);
    payload.writeBytes(encodeUtf8("onMetaData"));
    payload.writeU8(8); // AMF ECMA array
    payload.writeU32BE(1);
    payload.writeU16BE(5);
    payload.writeBytes(encodeUtf8("title"));
    const value = encodeUtf8(title);
    if (value.byteLength > 0xffffff - 33) throw new Error("FLV title exceeds tag size limit");
    payload.writeU8(value.byteLength > 65535 ? 12 : 2);
    if (value.byteLength > 65535) payload.writeU32BE(value.byteLength);
    else payload.writeU16BE(value.byteLength);
    payload.writeBytes(value);
    payload.writeU24BE(9); // AMF object end
    writeFlvTag(18, 0, payload.toUint8Array());
  }

  let videoSamples: readonly MediaSample[] = [];
  let audioSamples: readonly MediaSample[] = [];
  const videoTimescale = videoTrack?.timescale || 1000;
  const audioTimescale = audioTrack?.timescale || audioTrack?.codecDescriptions[0]?.sampleRate || 44100;

  const isFlv1 = videoTrack?.codecDescriptions[0]?.codecName === "flv1";
  if (videoTrack && isFlv1) {
    videoSamples = videoTrack.samples;
  } else if (videoTrack) {
    const w = videoTrack.width ?? 320;
    const h = videoTrack.height ?? 240;
    const desc = videoTrack.codecDescriptions[0];
    const avcCBytes =
      desc?.avcC?.rawBytes ??
      (() => {
        const { sps, pps } = buildH264SpsPps(w, h, 30);
        return buildAvcC([sps], [pps]);
      })();

    // AVC sequence header tag (avcPacketType = 0)
    const seqHeader = new Uint8Array(5 + avcCBytes.byteLength);
    seqHeader[0] = 0x17; // keyframe (1) + AVC (7)
    seqHeader[1] = 0x00; // AVC sequence header
    seqHeader.set(avcCBytes, 5);
    writeFlvTag(9, 0, seqHeader);

    const ts = videoTrack.timescale || 1000;
    let samples = videoTrack.samples;
    if (samples.length === 0 && videoTrack.decodedVideoFrames?.length) {
      samples = videoTrack.decodedVideoFrames.map((vf, idx) => {
        const encoded = encodeH264IdrFrame(vf.data, w, h, idx);
        return {
          data: encoded,
          dts: Math.round(vf.ptsSeconds * ts),
          pts: Math.round(vf.ptsSeconds * ts),
          cts: 0,
          duration: Math.round(vf.durationSeconds * ts),
          size: encoded.byteLength,
          isKeyframe: true,
          sampleDescriptionIndex: 1
        };
      });
    }

    videoSamples = samples;
  }

  let audioHeader = 0xaf;
  if (audioTrack?.codecDescriptions[0]?.codecName === "mp3") {
    const desc = audioTrack.codecDescriptions[0];
    const rate = desc.sampleRate ?? 44100;
    const rateBits = rate >= 44100 ? 3 : rate >= 22050 ? 2 : rate >= 11025 ? 1 : 0;
    audioHeader = ((rate === 8000 ? 14 : 2) << 4) | (rateBits << 2) | 2 | (desc.channels === 1 ? 0 : 1);
    audioSamples = audioTrack.samples;
  } else if (audioTrack) {
    const desc = audioTrack.codecDescriptions[0];
    const sr = desc?.sampleRate ?? 44100;
    const ch = desc?.channels ?? 2;
    const asc = desc?.esds?.decoderSpecificInfo ?? buildAudioSpecificConfig(sr, ch, 2);

    // AAC sequence header (aacPacketType = 0)
    const aacSeq = new Uint8Array(2 + asc.byteLength);
    aacSeq[0] = 0xaf; // SoundFormat=10 (AAC), 44kHz, 16-bit, stereo
    aacSeq[1] = 0x00;
    aacSeq.set(asc, 2);
    writeFlvTag(8, 0, aacSeq);

    audioSamples =
      audioTrack.samples.length > 0
        ? audioTrack.samples
        : [
            {
              data: createSilentAacFrame(ch),
              dts: 0,
              pts: 0,
              cts: 0,
              duration: 1024,
              size: 6,
              isKeyframe: true,
              sampleDescriptionIndex: 1
            }
          ];
  }

  // Merge the streams using their decode clocks, keeping codec headers first.
  let videoIndex = 0;
  let audioIndex = 0;
  let lastTimestampMs = 0;
  while (videoIndex < videoSamples.length || audioIndex < audioSamples.length) {
    const video = videoSamples[videoIndex];
    const audio = audioSamples[audioIndex];
    if (video && (!audio || video.dts / videoTimescale <= audio.dts / audioTimescale)) {
      const dtsMs = Math.round(video.dts / videoTimescale * 1000);
      const ctsMs = Math.round(video.cts / videoTimescale * 1000);
      const pkt = new Uint8Array((isFlv1 ? 1 : 5) + video.data.byteLength);
      if (isFlv1) {
        pkt[0] = (video.isKeyframe ? 0x10 : 0x20) | 0x02;
        pkt.set(video.data, 1);
      } else {
        pkt[0] = (video.isKeyframe ? 0x10 : 0x20) | 0x07;
        pkt[1] = 0x01; // AVC NALU
        pkt[2] = (ctsMs >>> 16) & 0xff;
        pkt[3] = (ctsMs >>> 8) & 0xff;
        pkt[4] = ctsMs & 0xff;
        pkt.set(video.data, 5);
      }
      writeFlvTag(9, dtsMs, pkt);
      lastTimestampMs = dtsMs;
      videoIndex++;
    } else if (audio) {
      const dtsMs = Math.round(audio.dts / audioTimescale * 1000);
      const headerSize = audioHeader >>> 4 === 10 ? 2 : 1;
      const pkt = new Uint8Array(headerSize + audio.data.byteLength);
      pkt[0] = audioHeader;
      if (headerSize === 2) pkt[1] = 0x01; // AAC raw
      pkt.set(audio.data, headerSize);
      writeFlvTag(8, dtsMs, pkt);
      lastTimestampMs = dtsMs;
      audioIndex++;
    }
  }

  if (videoTrack && !isFlv1) {
    // End the sequence after every media packet, even with a late stream start.
    writeFlvTag(9, Math.max(lastTimestampMs, Math.round(doc.durationSeconds * 1000)), new Uint8Array([0x17, 0x02, 0, 0, 0]));
  }

  return writer.toUint8Array();
}

export function probeFlv(
  bytes: Uint8Array,
  options: ParseMediaOptions & { showPackets?: boolean; showFrames?: boolean } = {}
): MediaProbeResult {
  const doc = parseFlv(bytes, options);
  return buildProbeResultFromDoc(doc, bytes.byteLength, options.filename ?? "input.flv", {
    ...options,
    formatName: "flv",
    formatLongName: "FLV (Flash Video)"
  });
}

export function flvAst(): MediaAstPlugin {
  return {
    id: "flv",
    formatName: "flv",
    formatLongName: "FLV (Flash Video)",
    extensions: ["flv"],
    mimeTypes: ["video/x-flv"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: ["h264", "flv1"],
    supportedAudioCodecs: ["aac", "mp3"],
    detect(bytes, filename) {
      if (isFlvSignature(bytes)) return true;
      if (filename && filename.toLowerCase().endsWith(".flv") && bytes.byteLength >= 9) {
        return isFlvSignature(bytes);
      }
      return false;
    },
    parse(bytes, options) {
      return parseFlv(bytes, options);
    },
    serialize(doc, options) {
      return serializeFlv(doc, options);
    },
    probe(bytes, options) {
      return probeFlv(bytes, options);
    },
    concat(docs, options) {
      return concatMp4(docs, options);
    },
    slice(doc, options) {
      return sliceMp4(doc, options);
    }
  };
}
