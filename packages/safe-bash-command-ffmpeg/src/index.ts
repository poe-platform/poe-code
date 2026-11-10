import { audioSpeakerMasks, parseAudioChannelCount, parseAudioChannelLayout } from "./audio-channel-layout.js";
import { ffmpegColors } from "./ffmpeg-colors.js";
import { encodeH264PresetTrack, h264Presets } from "@poe-code/mp4-ast";
import { parseFeedbackGraph, applyFeedback } from "./feedback.js";
import { applyOutputColors, parseOutputColorOption, type OutputColorOption } from "./color-options.js";
import { surroundAudio } from "./audio-surround.js";
import { denoiseWavelets } from "./audio-afwtdn.js";
import { ripemd128, ripemd256, ripemd320 } from "./ripemd.js";
import { parseTee, selectTeeTracks } from "./tee.js";
import { measureAstats } from "./audio-astats.js";
import { measureReplayGain } from "./audio-replaygain.js";
import { parseFilterExpression } from "./filter-expression.js";
import { autoConvertConcatTrack } from "./concat-auto-convert.js";
import { filterBitstream } from "./bitstream.js";
import { mergeVp9Superframes } from "./vp9-superframe.js";
import { authorTimecode } from "./timecode.js";
import { parseRawVideo, serializeRawVideo } from "./rawvideo.js";
import { formatYuv } from "./format-yuv.js";
import { deessAudio } from "./audio-deesser.js";
import { declickAudio } from "./audio-adeclick.js";
import { tmix } from "./tmix.js";
import { decimate } from "./decimate.js";
import { cutSubAudio } from "./audio-asubcut.js";
import { boostSubAudio } from "./audio-asubboost.js";
import { highpassAudio } from "./audio-highpass.js";
import { cutUltrasonicAudio } from "./audio-asupercut.js";
import { exciteAudio } from "./audio-aexciter.js";
import { psychoacousticClip } from "./audio-apsyclip.js";
import { renderTestsrc } from "./testsrc.js";
import { formatDate } from "safe-bash-calendar-engine/time-env/format";
import { millisecondsInstant, TimeZone } from "safe-bash-calendar-engine/time-env/calendar";
import { decodeMatroskaAss } from "./matroska-ass.js";
import { ciescopeFrame } from "./ciescope.js";
import { pixscopeFrame } from "./pixscope.js";
import { oscilloscope } from "./oscilloscope.js";
import { vibratoAudio } from "./audio-vibrato.js";
import { pulsateAudio } from "./audio-apulsator.js";
import { tremoloAudio } from "./audio-tremolo.js";
import { decorrelateAudio } from "./audio-adecorrelate.js";
import { phaseAudio } from "./audio-aphaser.js";
import { flangeAudio } from "./audio-flanger.js";
import { echoAudio } from "./audio-aecho.js";
import { chorusAudio } from "./audio-chorus.js";
import { shiftAudioPhase } from "./audio-aphaseshift.js";
import { correlateAudio } from "./audio-axcorrelate.js";
import { gateAudio } from "./audio-sidechaingate.js";
import { listenDynamicEqualizer } from "./audio-adynamicequalizer.js";
import { tiltAudio } from "./audio-atilt.js";
import { softClipAudio } from "./audio-asoftclip.js";
import { AlimiterError, limitAudio } from "./audio-alimiter.js";
import { applyAudioGate } from "./audio-agate.js";
import { compressAudio } from "./audio-acompressor.js";
import { normalizeSpeech } from "./audio-speechnorm.js";
import { normalizeAudio } from "./audio-dynaudnorm.js";
import { CompandError, compandAudio } from "./audio-compand.js";
import { multibandCompandAudio } from "./audio-mcompand.js";
import { removeSilence } from "./audio-silenceremove.js";
import { compensateAudioDelay } from "./audio-compensationdelay.js";
import { fadeAudio } from "./audio-fade.js";
import { acrossfadeAudio } from "./audio-acrossfade.js";
import { parseFilterBoolean } from "./filter-boolean.js";
import { headphoneAudio } from "./audio-headphone.js";
import { mixAudio } from "./audio-amix.js";
import { joinAudio } from "./audio-join.js";
import { enhanceDialogue } from "./audio-dialogue.js";
import { normalizeLoudness, resampleLoudnorm } from "./audio-loudnorm.js";
import { measureEbur128 } from "./audio-ebur128.js";
import { crc32Table, serializeFrameChecksum } from "./frame-checksum.js";
import { murmur3 } from "./murmur3.js";
import { md5, sha1, ripemd160 } from "@noble/hashes/legacy.js";
import { sha224, sha256, sha384, sha512, sha512_224, sha512_256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { createFfprobeCommand } from "safe-bash-command-ffprobe";
export { createFfprobeCommand } from "safe-bash-command-ffprobe";
export { evalSyncFfprobe } from "safe-bash-command-ffprobe/media";
import { isStdin, rethrowRuntimeError, createInputReader, loadManifestResources, resolvePath,
  formatIntrospectionOutput, getDefaultMediaRegistry, parseConcatManifest, parseHlsDuration,
  type MediaCommandsOptions as FfmpegCommandsOptions } from "safe-bash-command-ffprobe/media";
export type { MediaCommandsOptions as FfmpegCommandsOptions } from "safe-bash-command-ffprobe/media";
import { yieldTurn } from "safe-bash-contracts/yield";
import { resampleAudio } from "./audio-resample.js";
import { resampleStreamselectInput } from "./audio-astreamselect-resample.js";
import { resampleSoxr } from "./audio-soxr.js";
import { filterUnityTempo, stretchAudio } from "./audio-tempo.js";
import { datascopeFrame } from "./datascope.js";
import { scaleFrame } from "./scale.js";
import { xbrFrame } from "./xbr.js";
import { super2xsaiFrame } from "./super2xsai.js";
import { epxFrame } from "./epx.js";
import { hqxFrame } from "./hqx.js";
import { signalstats } from "./signalstats.js";
import { fixedSin, rotateYuvFrame } from "./rotate.js";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import {
  commandRuntimeIdentity,
  getCommandArguments,
  type CommandContext,
  type CommandDefinition
} from "safe-bash-contracts/command";
import { writeBytes } from "safe-bash-contracts/io";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";
import {
  compositeImage,
  decodeImage,
  encodeImage,
  extendImage,
  extractImage,
  flipImage,
  flopImage,
  resizeImage,
  rotateImage,
  type ImageFormat,
  type RgbaImage
} from "@poe-code/image-ast/portable";
import {
  encodeTga,
  matrixForRotation,
  allMediaAsts,
  cloudflareWorkerLimits,
  concatBytes,
  concatMp4,
  createMediaAstRegistry,
  createSyntheticMp4,
  decodeH264Samples,
  decodeAacTrack,
  decodeMp3Track,
  parseAdtsStream,
  scaleVideoPicture,
  decodeUtf8,
  decodeLatin1,
  encodeUtf8,
  serializeDashDocument,
  srtAst,
  ttmlAst,
  lrcAst,
  samiAst,
  realtextAst,
  subviewerAst,
  subviewer1Ast,
  aqtitleAst,
  microdvdAst,
  jacosubAst,
  mpl2Ast,
  stlAst,
  vplayerAst,
  assAst,
  webvttAst,
  ffmetadataAst,
  hlsAst,
  dashAst,
  MediaBudgetTracker,
  MediaLimitExceededError,
  muxMp4,
  muxMp4Steps,
  type MuxMediaOptions,
  parseMp4,
  parseMp4Boxes,
  sliceMp4,
  type MediaAstPlugin,
  type SerializeMediaOptions,
  type MediaAudioData,
  type MediaDocument,
  type MediaAttachment,
  type MediaFeatureOptions,
  type MediaResourceLimits,
  type MediaTrack,
  type MediaVideoFrame,
  type Mp4MetadataTags
} from "@poe-code/mp4-ast";

export {
  allMediaAsts,
  cloudflareWorkerLimits,
  srtAst,
  ttmlAst,
  lrcAst,
  samiAst,
  realtextAst,
  subviewerAst,
  subviewer1Ast,
  aqtitleAst,
  microdvdAst,
  jacosubAst,
  mpl2Ast,
  stlAst,
  vplayerAst,
  assAst,
  webvttAst,
  ffmetadataAst,
  hlsAst,
  dashAst,
  MediaBudgetTracker,
  MediaLimitExceededError,
  type MediaAstPlugin,
  type MediaFeatureOptions,
  type MediaResourceLimits,
  type MediaResourceLimits as FfmpegLimits
};

function serializeChecksum(
  doc: MediaDocument,
  format: string,
  algorithm: string,
  audioCodec: string | undefined,
  rawAudio: MediaAstPlugin | undefined,
  budget: MediaBudgetTracker,
  encoder?: MediaAstPlugin,
  encoderOptions?: SerializeMediaOptions
): Uint8Array {
  if (format === "streamhash") {
    return concatBytes(doc.tracks.map((track, index) => concatBytes([
      encodeUtf8(`${index},${track.type === "video" ? "v" : "a"},`),
      serializeChecksum({ ...doc, tracks: [track] }, "hash", algorithm, audioCodec, rawAudio, budget, encoder, encoderOptions)
    ])));
  }
  if (!doc.tracks.length || doc.tracks.some(track => track.type !== "audio" && track.type !== "video")) {
    throw new Error("Checksum output requires audio or video streams");
  }
  const packets: { dts: number; timescale: number; bytes: Uint8Array }[] = [];
  for (const track of doc.tracks) {
    if (track.type === "video") {
      if (!track.decodedVideoFrames) throw new Error("Video checksum output requires decoded frames");
      for (const frame of track.decodedVideoFrames) {
        budget.checkCpu();
        const native = frame.native;
        if (!native || native.rgba !== frame.data || native.width !== frame.width || native.height !== frame.height) {
          throw new Error("Video checksum output requires retained native pixels");
        }
        packets.push({ dts: frame.ptsSeconds, timescale: 1, bytes: native.pixels });
      }
      continue;
    }
    if (encoder) {
      // Reuse the container's encoder, then demux without decoding: only packet
      // payloads belong in the checksum, never headers or reconstructed PCM.
      const encoded = encoder.serialize({ ...doc, tracks: [track] }, { ...encoderOptions, audioCodec, budget });
      const encodedTrack = encoder.parse(encoded, { decodeAudio: false, budget }).tracks.find(t => t.type === "audio")!;
      for (const packet of encodedTrack.samples) {
        budget.checkCpu();
        packets.push({ dts: packet.dts, timescale: encodedTrack.timescale, bytes: packet.data });
      }
      continue;
    }
    if (!rawAudio?.canMux) throw new Error("Raw audio AST is not registered");
    const payload = rawAudio.serialize({ ...doc, tracks: [track] }, { audioCodec, budget });
    if (doc.tracks.length === 1 || !track.samples.length) {
      packets.push({ dts: 0, timescale: track.timescale, bytes: payload });
      continue;
    }
    const rate = track.decodedAudio?.sampleRate ?? track.codecDescriptions[0]?.sampleRate ?? track.timescale;
    const frames = track.decodedAudio?.channelData[0]?.length ?? Math.round(track.duration * rate / track.timescale);
    const bytesPerFrame = frames ? payload.length / frames : 0;
    let offset = 0;
    for (const packet of track.samples) {
      budget.checkCpu();
      const duration = Math.round(packet.duration * rate / track.timescale);
      const size = audioCodec === "copy" ? packet.data.length : Math.min(payload.length - offset, Math.round(duration * bytesPerFrame));
      packets.push({ dts: packet.dts, timescale: track.timescale, bytes: payload.subarray(offset, offset + size) });
      offset += size;
    }
  }
  // Equal timestamps retain mapped output stream order.
  packets.sort((a, b) => {
    budget.checkCpu();
    return a.dts * b.timescale - b.dts * a.timescale;
  });
  const name = algorithm.toLowerCase();
  if (format === "crc" || name === "adler32") {
    // FFmpeg's crc muxer uses Adler-32 rather than a CRC polynomial.
    let a = 1;
    let b = 0;
    for (const { bytes } of packets) {
      for (let i = 0; i < bytes.length; i++) {
        if (i % 4096 === 0) budget.checkCpu();
        a = (a + bytes[i]!) % 65521;
        b = (b + a) % 65521;
      }
    }
    return encodeUtf8(`${format === "crc" ? "CRC=0x" : "adler32="}${((b * 65536 + a) >>> 0).toString(16).padStart(8, "0")}\n`);
  }
  if (name === "crc32") {
    let crc = 0xffffffff;
    for (const { bytes } of packets) {
      for (let i = 0; i < bytes.length; i++) {
        if (i % 4096 === 0) budget.checkCpu();
        crc = (crc >>> 8) ^ crc32Table[(crc ^ bytes[i]!) & 255]!;
      }
    }
    return encodeUtf8(`CRC32=${((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0")}\n`);
  }
  if (name === "murmur3") {
    return encodeUtf8(`murmur3=${bytesToHex(murmur3(packets.map(packet => packet.bytes), budget))}\n`);
  }
  const hashes = { md5, sha160: sha1, sha224, sha256, sha384, sha512, ripemd128, ripemd160, ripemd256, ripemd320, "sha512/224": sha512_224, "sha512/256": sha512_256 };
  if (!Object.hasOwn(hashes, name)) throw new Error(`Unknown hash algorithm '${algorithm}'`);
  const hash = hashes[name as keyof typeof hashes].create();
  for (const { bytes } of packets) {
    for (let offset = 0; offset < bytes.length; offset += 65536) {
      budget.checkCpu();
      hash.update(bytes.subarray(offset, offset + 65536));
    }
  }
  return encodeUtf8(`${name.toUpperCase()}=${bytesToHex(hash.digest())}\n`);
}

function parseScaledFrameLimit(value: string | undefined): number {
  let number = value ?? "";
  const binary = number.endsWith("i");
  if (binary) number = number.slice(0, -1);
  const powers: Record<string, number> = {
    y: -24, z: -21, a: -18, f: -15, p: -12, n: -9, u: -6, m: -3,
    c: -2, d: -1, h: 2, k: 3, K: 3, M: 6, G: 9, T: 12, P: 15, E: 18, Z: 21, Y: 24
  };
  const power = powers[number.slice(-1)];
  if (power !== undefined) number = number.slice(0, -1);
  const scale = power === undefined ? 1 : binary ? 2 ** (power / 3 * 10) : 10 ** power;
  return number.trim() && (!binary || power !== undefined) ? Number(number) * scale : NaN;
}

function parseBitrate(value: string | undefined): number | undefined {
  const suffix = value?.slice(-1);
  const scale = suffix === "k" || suffix === "K" ? 1000 : suffix === "M" ? 1000000 : 1;
  const number = scale === 1 ? value : value?.slice(0, -1);
  const bitrate = number?.trim() ? Number(number) * scale : NaN;
  if (!Number.isSafeInteger(bitrate) || bitrate < 0 || bitrate > 2147483647) {
    return undefined;
  }
  return bitrate;
}

function parseFileSize(value: string | undefined): number {
  let text = value ?? "";
  const binary = text.endsWith("i");
  if (binary) text = text.slice(0, -1);
  const power = text ? "kMGTPE".indexOf(text.endsWith("K") ? "k" : text.slice(-1)) + 1 : 0;
  if (power) text = text.slice(0, -1);
  const size = text.trim() ? Number(text) * (binary ? 1024 : 1000) ** power : NaN;
  if ((binary && !power) || !Number.isSafeInteger(size) || size < 0) throw new Error("Invalid file size limit");
  return size;
}

function serializeLimitedWav(
  document: MediaDocument, plugin: MediaAstPlugin,
  options: Parameters<MediaAstPlugin["serialize"]>[1], fileSize: number | undefined
): Uint8Array {
  if (fileSize !== undefined) {
    // The muxer checks its current position before accepting the next packet.
    // Serialize only the header to account for metadata and optional WAV chunks.
    const track = document.tracks.find(track => track.type === "audio");
    if (!track) throw new Error("WAV output requires an audio stream");
    const empty = { ...document, tracks: [{ ...track, samples: [], duration: 0 }] };
    let position = plugin.serialize(empty, options).byteLength;
    let packets = 0;
    for (const sample of track.samples) {
      if (position >= fileSize) break;
      options?.budget?.checkCpu();
      position += sample.data.byteLength;
      packets++;
    }
    const samples = track.samples.slice(0, packets);
    document = { ...document, tracks: [{ ...track, samples,
      duration: samples.reduce((total, sample) => total + sample.duration, 0) }] };
  }
  return plugin.serialize(document, options);
}

function parseFrameRate(value: string): number | undefined {
  switch (value) {
    case "ntsc": case "qntsc": case "sntsc": return 30000 / 1001;
    case "pal": case "qpal": case "spal": return 25;
    case "film": return 24;
    case "ntsc-film": return 24000 / 1001;
  }
  const [numerator, denominator = "1", extra] = value.split("/");
  if (extra !== undefined || !numerator?.trim() || !denominator.trim()) return undefined;
  const rate = Number(numerator) / Number(denominator);
  return Number.isFinite(rate) && rate > 0 ? rate : undefined;
}

function loopToOutputEnd(
  doc: MediaDocument,
  endSeconds: number | undefined,
  budget: MediaBudgetTracker
): MediaDocument {
  if (endSeconds === undefined || !Number.isFinite(endSeconds)) {
    throw new Error("-stream_loop -1 requires a finite output -t or -to");
  }
  budget.checkDuration(endSeconds);
  if (doc.durationSeconds <= 0 || endSeconds <= doc.durationSeconds) return doc;
  const copies = Math.ceil(endSeconds / doc.durationSeconds);
  budget.checkConcatInputs(copies);
  budget.allocateMemory(copies * 8);
  try {
    return concatMp4(Array.from({ length: copies }, () => doc), { budget });
  } finally {
    budget.releaseMemory(copies * 8);
  }
}

function isStdout(path: string): boolean {
  return ["-", "pipe:", "pipe:1", "/dev/stdout", "/dev/fd/1"].includes(path);
}

async function writeMediaOutput(
  context: CommandContext,
  target: string,
  bytes: Uint8Array,
  budget: MediaBudgetTracker
): Promise<void> {
  if (target.startsWith("md5:")) {
    const hash = md5.create();
    for (let offset = 0; offset < bytes.byteLength; offset += 65536) {
      budget.checkCpu();
      context.signal?.throwIfAborted();
      hash.update(bytes.subarray(offset, offset + 65536));
    }
    bytes = encodeUtf8(`${bytesToHex(hash.digest())}\n`);
    target = target.slice(4) || "pipe:1";
  }
  if (isStdout(target)) await writeBytes(context.stdout, bytes, context.signal);
  else if (target !== "/dev/null") await writeFileOutput(context, bytes,
    data => context.fs.writeFile(resolvePath(context.cwd, target), data, { signal: context.signal }));
}

function dirnameOf(p: string): string {
  const idx = p.lastIndexOf("/");
  if (idx <= 0) return "/";
  return p.slice(0, idx);
}

export function parseFfmpegTimestamp(spec: string): number {
  const trimmed = spec.trim();
  if (!trimmed) return 0;
  if (trimmed.endsWith("ms")) {
    return (parseFloat(trimmed.slice(0, -2)) || 0) / 1000;
  }
  if (trimmed.endsWith("us")) {
    return (parseFloat(trimmed.slice(0, -2)) || 0) / 1_000_000;
  }
  if (trimmed.endsWith("s") && !trimmed.includes(":")) {
    return parseFloat(trimmed.slice(0, -1)) || 0;
  }
  if (trimmed.includes(":")) {
    const parts = trimmed.split(":").map((x) => parseFloat(x) || 0);
    if (parts.length === 3) {
      return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
    }
    if (parts.length === 2) {
      return parts[0]! * 60 + parts[1]!;
    }
  }
  return parseFloat(trimmed) || 0;
}


function parseColorRgba(colorStr: string): [number, number, number, number] {
  const value = colorStr.trim().toLowerCase();
  const separator = value.indexOf("@");
  const s = separator < 0 ? value : value.slice(0, separator);
  let alpha: number | undefined;
  if (separator >= 0) {
    const suffix = value.slice(separator + 1);
    const opacity = Number(suffix);
    const maximum = suffix.startsWith("0x") ? 255 : 1;
    if (!suffix || !Number.isFinite(opacity) || opacity < 0 || opacity > maximum
      || ["0b", "0o"].includes(suffix.trimStart().slice(0, 2))) {
      throw new Error(`Invalid color alpha: ${colorStr}`);
    }
    alpha = Math.floor(opacity * 255 / maximum);
  }
  const named = Object.hasOwn(ffmpegColors, s) ? ffmpegColors[s] : undefined;
  if (named) return [...named, alpha ?? 255];
  const hex = s.startsWith("#") ? s.slice(1) : s.startsWith("0x") ? s.slice(2) : s;
  if ((hex.length === 6 || hex.length === 8) && [...hex].every((digit) => "0123456789abcdef".includes(digit))) {
    return [
      parseInt(hex.slice(0, 2), 16) || 0,
      parseInt(hex.slice(2, 4), 16) || 0,
      parseInt(hex.slice(4, 6), 16) || 0,
      alpha ?? (hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255)
    ];
  }
  throw new Error(`Invalid color: ${colorStr}`);
}

function detachBytesBuffer(bytes: Uint8Array | undefined): void {
  if (!bytes) return;
  const buf = bytes.buffer as ArrayBuffer & { transfer?: (newByteLength?: number) => ArrayBuffer };
  if (typeof buf.transfer === "function" && bytes.byteOffset === 0 && bytes.byteLength === buf.byteLength) {
    try {
      buf.transfer(0);
    } catch {
      // Buffer may be non-detachable.
    }
  }
}

function encodeIcoFrames(frames: readonly MediaVideoFrame[], budget: MediaBudgetTracker): Uint8Array {
  if (frames.length < 1 || frames.length > 65535) throw new Error("ICO requires between 1 and 65535 images");
  budget.checkSamples(frames.length);
  let size = 6 + frames.length * 16;
  const payloads = frames.map(frame => {
    if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width < 1 || frame.height < 1 || frame.width > 256 || frame.height > 256) {
      throw new Error("ICO dimensions must be between 1 and 256");
    }
    budget.checkCpu();
    const png = encodeImage(makeRgbaImg(frame.width, frame.height, frame.data), { format: "png" }).data;
    size += png.length;
    if (size > 0xffffffff) throw new Error("ICO output exceeds 32-bit offsets");
    budget.checkOutputBytes(size);
    return png;
  });
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, frames.length, true);
  let offset = 6 + frames.length * 16;
  frames.forEach((frame, i) => {
    const p = 6 + i * 16;
    const png = payloads[i]!;
    bytes[p] = frame.width % 256;
    bytes[p + 1] = frame.height % 256;
    view.setUint16(p + 4, 1, true);
    view.setUint16(p + 6, 32, true);
    view.setUint32(p + 8, png.length, true);
    view.setUint32(p + 12, offset, true);
    bytes.set(png, offset);
    offset += png.length;
  });
  return bytes;
}

function encodeApngFrames(frames: readonly MediaVideoFrame[], plays: number, budget: MediaBudgetTracker): Uint8Array {
  const first = frames[0];
  if (!first) throw new Error("No video frame in the requested presentation interval");
  const { width, height } = first;
  const frameSize = width * height * 4;
  const size = frameSize * frames.length;
  budget.checkSamples(frames.length);
  budget.allocateMemory(size);
  try {
    const data = new Uint8Array(size);
    const delay: number[] = [];
    for (const [index, frame] of frames.entries()) {
      budget.checkCpu();
      if (frame.width !== width || frame.height !== height) throw new Error("APNG frames must have the same dimensions");
      data.set(frame.data, index * frameSize);
      // The muxer uses timestamp intervals and repeats the last interval at EOF.
      delay.push(index + 1 < frames.length
        ? (frames[index + 1]!.ptsSeconds - frame.ptsSeconds) * 1000
        : delay[index - 1] ?? frame.durationSeconds * 1000);
    }
    budget.checkDuration(delay.reduce((total, value) => total + value, 0) / 1000);
    const bytes = encodeImage(makeRgbaImg(width, height * frames.length, data), {
      format: "apng", pageHeight: height, delay, loop: plays
    }).data;
    budget.checkOutputBytes(bytes.length);
    return bytes;
  } finally {
    budget.releaseMemory(size);
  }
}

// FFmpeg's systematic BGR8 palette used by format=pal8.
const pal8Palette = Uint8Array.from({ length: 768 }, (_, i) => {
  const index = Math.floor(i / 3);
  return i % 3 === 0 ? (index & 7) * 36 : i % 3 === 1 ? ((index >> 3) & 7) * 36 : (index >> 6) * 85;
});

function makeRgbaImg(width: number, height: number, data: Uint8Array): RgbaImage {
  return {
    width,
    height,
    channels: 4,
    data,
    format: "png",
    space: "srgb",
    depth: "uchar",
    density: 72,
    hasAlpha: true
  };
}

function* lavfiSteps(
  spec: string,
  budget: MediaBudgetTracker,
  durationOverride?: number
): Generator<void, MediaDocument> {
  let work = 0;
  // Examples:
  // color=c=red:s=320x240:r=25:d=2
  // testsrc=size=160x120:rate=10:duration=1
  // sine=frequency=440:sample_rate=44100:duration=1
  // anullsrc=r=44100:cl=stereo
  const eqIdx = spec.indexOf("=");
  const filterName = (eqIdx >= 0 ? spec.slice(0, eqIdx) : spec).trim().toLowerCase();
  const argsPart = eqIdx >= 0 ? spec.slice(eqIdx + 1) : "";
  const kv: Record<string, string> = {};
  for (const part of argsPart.split(":")) {
    if (++work % 1024 === 0) yield;

    const kIdx = part.indexOf("=");
    if (kIdx >= 0) {
      kv[part.slice(0, kIdx).trim().toLowerCase()] = part.slice(kIdx + 1).trim();
    } else if (part.trim()) {
      kv._0 = part.trim();
    }
  }

  if (filterName === "sine" || filterName === "anullsrc") {
    const sampleRate = parseInt(kv.sample_rate ?? kv.r ?? "44100", 10) || 44100;
    const parsedFrequency = parseFloat(kv.frequency ?? kv.f ?? "440");
    const freq = Number.isNaN(parsedFrequency) ? 440 : parsedFrequency;
    const duration =
      durationOverride ?? (parseFloat(kv.duration ?? kv.d ?? "1") || 1);
    const layout = kv.channel_layout ?? kv.cl;
    const channels = layout === "mono" || layout === undefined && filterName === "sine" ? 1 : 2;
    const totalSamples = Math.max(0, Math.round(duration * sampleRate));
    budget.checkDuration(duration);

    const channelData: Float32Array[] = [];
    for (let channel = 0; channel < channels; channel++) {
      const arr = new Float32Array(totalSamples);
      if (filterName === "sine") {
        for (let i = 0; i < totalSamples; i++) {
          if (i % 4096 === 0) yield;
          arr[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.125;
        }
      }
      channelData.push(arr);
    }

    yield;
    const mp4Bytes = createSyntheticMp4({
      width: 16,
      height: 16,
      fps: 10,
      durationSeconds: duration,
      includeAudio: true,
      sampleRate,
      channels
    });
    const base = parseMp4(mp4Bytes);
    const audioTrack = base.tracks.find((t) => t.type === "audio")!;
    return {
      ...base,
      tracks: [
        {
          ...audioTrack,
          id: 1,
          decodedAudio: { sampleRate, channels, channelData }
        }
      ]
    };
  }

  const sizeStr = kv.size ?? kv.s ?? "320x240";
  const [wStr, hStr] = sizeStr.toLowerCase().split("x");
  const width = parseInt(wStr ?? "320", 10) || 320;
  const height = parseInt(hStr ?? "240", 10) || 240;
  const fps = parseFloat(kv.rate ?? kv.r ?? "25") || 25;
  const duration =
    durationOverride ?? (parseFloat(kv.duration ?? kv.d ?? "1") || 1);
  const frameCount = Math.max(1, Math.round(duration * fps));
  const color = parseColorRgba(kv.color ?? kv.c ?? kv._0 ?? "blue");
  if (filterName === "color") {
    // The default color source is limited-range BT.601 YUV420P. Match
    // FFmpeg 7's RGB conversion, which truncates each fixed-point product.
    const [r, g, b] = color;
    const y = (263 * r + 516 * g + 100 * b + 512) >> 10;
    const u = (-152 * r - 298 * g + 450 * b + 511) >> 10;
    const v = (450 * r - 377 * g - 73 * b + 511) >> 10;
    const luma = (y * 9539) >> 13;
    color[0] = Math.max(0, Math.min(255, luma + ((v * 13075) >> 13)));
    color[1] = Math.max(0, Math.min(255, luma + ((u * -3209) >> 13) + ((v * -6660) >> 13)));
    color[2] = Math.max(0, Math.min(255, luma + ((u * 16525) >> 13)));
  }

  const top = [[191, 191, 191], [191, 191, 0], [0, 191, 191], [0, 191, 0], [191, 0, 191], [191, 0, 0], [0, 0, 191]];
  const middle = [[0, 0, 191], [19, 19, 19], [191, 0, 191], [19, 19, 19], [0, 191, 191], [19, 19, 19], [191, 191, 191]];
  const lower = [[0, 33, 76], [255, 255, 255], [50, 0, 106], [19, 19, 19], [9, 9, 9], [19, 19, 19], [29, 29, 29], [19, 19, 19]];
  const frames: MediaVideoFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    yield;
    budget.recordFrame(width, height);
    const rgba = new Uint8Array(width * height * 4);
    if (filterName === "testsrc") {
      yield* renderTestsrc(rgba, width, height, i / fps);
    } else for (let y = 0; y < height; y++) {
      if (y % 16 === 0) yield;
      for (let x = 0; x < width; x++) {
        if (++work % 1024 === 0) yield;

        const idx = (y * width + x) * 4;
        if (filterName === "smptebars") {
          const column = Math.min(6, Math.floor(x * 7 / width));
          const bottomColumn = x < width * 5 / 7 ? Math.min(3, Math.floor(x * 28 / (width * 5)))
            : x < width * 6 / 7 ? 4 + Math.min(2, Math.floor((x * 7 / width - 5) * 3)) : 7;
          const pixel = y < height * 2 / 3 ? top[column]! : y < height * 3 / 4 ? middle[column]! : lower[bottomColumn]!;
          rgba[idx] = pixel[0]!;
          rgba[idx + 1] = pixel[1]!;
          rgba[idx + 2] = pixel[2]!;
          rgba[idx + 3] = 255;
        } else if (filterName.startsWith("testsrc")) {
          const bar = Math.floor((x / Math.max(1, width)) * 7);
          const palette: [number, number, number][] = [
            [255, 255, 255],
            [255, 255, 0],
            [0, 255, 255],
            [0, 255, 0],
            [255, 0, 255],
            [255, 0, 0],
            [0, 0, 255]
          ];
          const [r, g, b] = palette[bar % 7]!;
          const scanY = (i * 16) % Math.max(16, height);
          const inScanBar = y >= scanY && y < scanY + 16;
          rgba[idx] = inScanBar ? (r ^ 0x80) : r;
          rgba[idx + 1] = inScanBar ? (g ^ 0x80) : g;
          rgba[idx + 2] = inScanBar ? (b ^ 0x80) : b;
          rgba[idx + 3] = 255;
        } else {
          rgba[idx] = color[0];
          rgba[idx + 1] = color[1];
          rgba[idx + 2] = color[2];
          rgba[idx + 3] = color[3];
        }
      }
    }
    frames.push({
      width,
      height,
      data: rgba,
      ptsSeconds: i / fps,
      durationSeconds: 1 / fps,
      keyframe: true
    });
  }

  yield;
  const mp4Bytes = createSyntheticMp4({
    width,
    height,
    fps,
    frameCount: 1,
    color: [color[0], color[1], color[2]],
    includeAudio: false
  });
  const parsed = parseMp4(mp4Bytes);
  return {
    ...parsed,
    duration: Math.round(frameCount / fps * parsed.timescale),
    durationSeconds: frameCount / fps,
    tracks: parsed.tracks.map((t) =>
      t.type === "video"
        ? { ...t, duration: Math.round(frameCount / fps * t.timescale), samples: [], decodedVideoFrames: frames }
        : t
    )
  };
}

// FFmpeg retains the last decoded AAC frame beyond the container's presentation
// duration. Decode before user time cuts so explicit -t/-to still trim PCM exactly.
function decodeAacInput(doc: MediaDocument): MediaDocument {
  if (!doc.tracks.some(track => track.codecDescriptions[0]?.codecName === "aac" && !track.decodedAudio)) return doc;
  const tracks = doc.tracks.map(track => {
    if (track.codecDescriptions[0]?.codecName !== "aac" || track.decodedAudio) return track;
    const decodedAudio = decodeAacTrack(doc, track, true);
    return { ...track, decodedAudio,
      duration: decodedAudio.channelData[0]!.length * track.timescale / decodedAudio.sampleRate };
  });
  const durationSeconds = Math.max(doc.durationSeconds, ...tracks.map(track => track.duration / track.timescale));
  return { ...doc, tracks, durationSeconds, duration: Math.round(durationSeconds * doc.timescale) };
}

async function ensureDecodedFrames(
  track: MediaTrack,
  movieTimescale: number,
  budget: MediaBudgetTracker,
  signal?: AbortSignal,
  maxFrames?: number
): Promise<MediaVideoFrame[]> {
  if (maxFrames === 0) return [];
  const width = track.width ?? track.codecDescriptions[0]?.width ?? 64;
  const height = track.height ?? track.codecDescriptions[0]?.height ?? 64;
  const ts = track.timescale || 90000;
  const frames: MediaVideoFrame[] = [];
  const decoded = track.decodedVideoFrames ?? decodeH264Samples(track.samples, track.codecDescriptions, width, height, ts);
  for (const frame of decoded) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    if (!track.decodedVideoFrames) budget.recordFrame(frame.width, frame.height);
    // Retained keyframes and B-frame references can precede the visible interval.
    // Keep media timestamps: filters and serializers still apply the edit list.
    const pts = Math.round(frame.ptsSeconds * ts);
    if (track.editList?.length && !track.editList.some(edit =>
      edit.mediaTime >= 0 && pts >= edit.mediaTime &&
      pts < edit.mediaTime + edit.segmentDuration * ts / movieTimescale
    )) continue;
    frames.push(frame);
    if (maxFrames !== undefined && frames.length >= maxFrames) break;
  }
  return frames;
}

function roundToEven(value: number): number {
  const lower = Math.floor(value);
  // FFmpeg uses lrint: exact halves round to the nearest even integer.
  return value - lower === 0.5 ? lower + Math.abs(lower % 2) : Math.round(value);
}



const GLYPH_5X7: Record<string, readonly number[]> = {
  " ": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  "A": [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  "B": [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  "C": [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  "D": [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c],
  "E": [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  "F": [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  "G": [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  "H": [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  "I": [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "J": [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  "K": [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  "L": [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  "M": [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  "N": [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  "O": [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  "P": [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  "Q": [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  "R": [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  "S": [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  "T": [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  "U": [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  "V": [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  "W": [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
  "X": [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  "Y": [0x11, 0x11, 0x11, 0x0a, 0x04, 0x04, 0x04],
  "Z": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  ".": [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c],
  ",": [0x00, 0x00, 0x00, 0x00, 0x0c, 0x04, 0x08],
  ":": [0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x0c, 0x00],
  "-": [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  "_": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1f],
  "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
  "?": [0x0e, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04]
};

async function renderBitmapTextToRgba(
  rgba: Uint8Array,
  width: number,
  height: number,
  text: string,
  opts: {
    xExpr?: string;
    yExpr?: string;
    fontSize?: number;
    horizontalScale?: number;
    fontColor?: [number, number, number, number];
    drawBox?: boolean;
    preserveAlpha?: boolean;
    boxColor?: [number, number, number, number];
  } = {},
  signal?: AbortSignal
): Promise<Uint8Array> {
  let work = 0;

  const out = new Uint8Array(rgba);
  const scale = Math.max(1, Math.round((opts.fontSize ?? 12) / 8));
  const scaleX = scale * (opts.horizontalScale ?? 1);
  const charW = 6 * scaleX;
  const charH = 8 * scale;
  const lines = text.split("\n");
  const maxCols = Math.max(1, ...lines.map((l) => l.length));
  const textW = maxCols * charW;
  const textH = lines.length * charH;

  const evalPos = (expr: string | undefined, defVal: number): number => {
    if (!expr) return defVal;
    const clean = expr.trim().toLowerCase();
    if (clean.includes("(w-text_w)/2") || clean.includes("(w-tw)/2")) {
      return Math.floor((width - textW) / 2);
    }
    if (clean.includes("(h-text_h)/2") || clean.includes("(h-th)/2")) {
      return Math.floor((height - textH) / 2);
    }
    if (clean.startsWith("h-text_h-") || clean.startsWith("h-th-")) {
      const off = parseInt(clean.split("-").pop() ?? "8", 10) || 8;
      return Math.max(0, height - textH - off);
    }
    if (clean.startsWith("w-text_w-")) {
      return Math.max(0, width - textW - Number(clean.slice("w-text_w-".length)));
    }
    const num = parseInt(clean, 10);
    return Number.isFinite(num) ? num : defVal;
  };

  const startX = evalPos(opts.xExpr, Math.max(2, Math.floor((width - textW) / 2)));
  const startY = evalPos(opts.yExpr, Math.max(2, height - textH - 6));
  const fg = opts.fontColor ?? [255, 255, 255, 255];

  if (opts.drawBox) {
    const bg = opts.boxColor ?? [0, 0, 0, 180];
    const pad = 2 * scale;
    for (let y = Math.max(0, startY - pad); y < Math.min(height, startY + textH + pad); y++) {
      if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

      for (let x = Math.max(0, startX - pad); x < Math.min(width, startX + textW + pad); x++) {
        if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

        const idx = (y * width + x) * 4;
        const alpha = bg[3] / 255;
        out[idx] = Math.round(bg[0] * alpha + out[idx]! * (1 - alpha));
        out[idx + 1] = Math.round(bg[1] * alpha + out[idx + 1]! * (1 - alpha));
        out[idx + 2] = Math.round(bg[2] * alpha + out[idx + 2]! * (1 - alpha));
        if (!opts.preserveAlpha) out[idx + 3] = 255;
      }
    }
  }

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

    const line = lines[lineIdx]!.toUpperCase();
    const lineY = startY + lineIdx * charH;
    for (let cIdx = 0; cIdx < line.length; cIdx++) {
      if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

      const ch = line[cIdx]!;
      const rows = GLYPH_5X7[ch] ?? GLYPH_5X7["?"];
      if (!rows) continue;
      const charX = startX + cIdx * charW;
      for (let r = 0; r < 7; r++) {
        if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

        const mask = rows[r]!;
        for (let col = 0; col < 5; col++) {
          if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

          if ((mask & (1 << (4 - col))) === 0) continue;
          for (let sy = 0; sy < scale; sy++) {
            if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

            for (let px = Math.max(0, Math.round(charX + col * scaleX)); px < Math.min(width, Math.round(charX + (col + 1) * scaleX)); px++) {
              if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

              const py = lineY + r * scale + sy;
              if (px >= 0 && px < width && py >= 0 && py < height) {
                const idx = (py * width + px) * 4;
                const alpha = fg[3] / 255;
                out[idx] = Math.round(fg[0] * alpha + out[idx]! * (1 - alpha));
                out[idx + 1] = Math.round(fg[1] * alpha + out[idx + 1]! * (1 - alpha));
                out[idx + 2] = Math.round(fg[2] * alpha + out[idx + 2]! * (1 - alpha));
                if (!opts.preserveAlpha) out[idx + 3] = 255;
              }
            }
          }
        }
      }
    }
  }

  return out;
}

function parseFilterChain(filterChainStr: string): string[] {
  const filters: string[] = [];
  let filter = "";
  let quoted = false;
  for (let i = 0; i < filterChainStr.length; i++) {
    const char = filterChainStr[i]!;
    // FFmpeg quotes protect all characters; backslashes escape only outside quotes.
    if (char === "'") {
      quoted = !quoted;
    } else if (!quoted && char === "\\" && i + 1 < filterChainStr.length) {
      filter += filterChainStr[++i]!;
    } else if (!quoted && char === ",") {
      if (filter.trim()) filters.push(filter.trim());
      filter = "";
    } else {
      filter += char;
    }
  }
  if (filter.trim()) filters.push(filter.trim());

  return filters;
}

function parseAsetnsamples(argument: string) {
  let size = 1024;
  let pad = true;
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["n", "p"][index] : option.slice(0, separator);
    const value = separator < 0 ? option : option.slice(separator + 1);
    if (key === "n" || key === "nb_out_samples") {
      const number = parseFilterExpression(value, "asetnsamples", { PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2 });
      if (number < 1 || number > 2147483647) throw new RangeError("asetnsamples: invalid frame size");
      size = roundToEven(number);
    } else if (key === "p" || key === "pad") {
      const boolean = value.toLowerCase();
      if (!["0", "1", "false", "true", "no", "yes", "off", "on"].includes(boolean)) throw new Error("asetnsamples: invalid pad");
      pad = ["1", "true", "yes", "on"].includes(boolean);
    } else throw new Error(`asetnsamples: unsupported option ${key}`);
  }
  return { size, pad };
}

function parseAtrim(argument: string, origRate: number, timeBase = 1 / origRate) {
  let duration = 0;
  const bounds = new Map<string, number>();
  const options: string[] = [];
  let option = "";
  let quoted = false;
  // Decode the option layer after parseFilterChain decoded the graph layer.
  for (let i = 0; i < argument.length; i++) {
    const char = argument[i]!;
    if (char === "'") quoted = !quoted;
    else if (!quoted && char === "\\" && i + 1 < argument.length) option += argument[++i]!;
    else if (!quoted && char === ":") {
      options.push(option);
      option = "";
    } else option += char;
  }
  if (argument) options.push(option);
  for (const [index, option] of options.entries()) {
    const separator = option.indexOf("=");
    let key = separator < 0 ? ["start", "end", "start_pts", "end_pts", "duration", "start_sample", "end_sample"][index] : option.slice(0, separator).trim();
    if (key === "starti" || key === "endi") key = key.slice(0, -1);
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    const samples = key === "start_sample" || key === "end_sample";
    if (key === "duration" || key === "durationi") {
      const seconds = parseHlsDuration(value);
      duration = Math.round(seconds * origRate);
      if (!value || Number.isNaN(seconds)) throw new Error(`atrim: invalid ${key}`);
      if (seconds < 0 || !Number.isSafeInteger(duration)) {
        throw new RangeError(`atrim: invalid ${key}`);
      }
      continue;
    }
    const pts = key === "start_pts" || key === "end_pts";
    if (key === undefined || (!samples && !pts && key !== "start" && key !== "end")) {
      throw new Error(`atrim: unsupported option ${key}`);
    }
    const number = samples || pts ? parseFilterExpression(value, "atrim", { inf: Infinity, Infinity, NaN }) : parseHlsDuration(value);
    const boundary = samples || pts ? roundToEven(number) : Math.round(number * origRate);
    // Native int64 options use doubles, including INT64_MAX rounded to 2^63.
    if (!value || Number.isNaN(number)) throw new Error(`atrim: invalid ${key}`);
    if ((samples || pts ? Math.abs(number) > 2 ** 63 : !Number.isSafeInteger(boundary)) ||
        (samples && number < (key === "start_sample" ? -1 : 0))) {
      throw new RangeError(`atrim: invalid ${key}`);
    }
    // INT64_MIN is the unset PTS sentinel, including when an option is repeated.
    if (pts && boundary === -(2 ** 63)) {
      bounds.delete(key);
      continue;
    }
    if (key === "start_sample" && boundary === -1) bounds.delete(key);
    else bounds.set(key, pts ? Math.sign(boundary) * Math.round(Math.abs(boundary) * (timeBase * origRate)) : boundary);
  }
  const startPts = Math.min(bounds.get("start") ?? Infinity, bounds.get("start_pts") ?? Infinity);
  const endPts = Math.max(bounds.get("end") ?? -Infinity, bounds.get("end_pts") ?? -Infinity);
  const startSample = bounds.get("start_sample") ?? Infinity;
  const endSample = bounds.get("end_sample") ?? -Infinity;
  return { duration, startPts, endPts, startSample, endSample };
}

function serializeFilterChain(filters: string[]): string {
  // Parsed filters have lost their quoting; protect literal separators before reparsing.
  return filters.map(filter => filter.replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll(",", "\\,")).join(",");
}

async function renderShowwavespic(
  audio: MediaAudioData, spec: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame> {
  const equals = spec.indexOf("=");
  if ((equals < 0 ? spec : spec.slice(0, equals)) !== "showwavespic") {
    throw new Error("showwavespic: preceding filters are unsupported");
  }
  const options: Record<string, string> = {};
  for (const [index, part] of (equals < 0 ? [] : spec.slice(equals + 1).split(":")).entries()) {
    const separator = part.indexOf("=");
    let key = separator < 0 ? ["size", "split_channels", "colors", "scale", "draw", "filter"][index] : part.slice(0, separator);
    if (key === "s") key = "size";
    if (!key || !["size", "split_channels", "colors", "scale", "draw", "filter"].includes(key)) {
      throw new Error(`showwavespic: unsupported option ${key ?? part}`);
    }
    options[key] = separator < 0 ? part : part.slice(separator + 1);
  }
  const dimensions = (options.size ?? "600x240").split("x");
  const [width = NaN, height = NaN] = dimensions.map(Number);
  if (dimensions.length !== 2 || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width <= 0 || height <= 0 || !Number.isSafeInteger(width * height * 4)) {
    throw new Error("showwavespic: invalid image size");
  }
  const splitOption = options.split_channels ?? "0";
  if (!["0", "1", "false", "true"].includes(splitOption)) throw new Error("showwavespic: invalid split_channels");
  const split = splitOption === "1" || splitOption === "true";
  if (options.scale !== undefined && options.scale !== "lin" && options.scale !== "0") {
    throw new Error("showwavespic: only linear scaling is supported");
  }
  if (options.draw !== undefined && options.draw !== "scale" && options.draw !== "0") {
    throw new Error("showwavespic: only scaled drawing is supported");
  }
  const filter = options.filter ?? "average";
  if (!["average", "peak", "0", "1"].includes(filter)) throw new Error("showwavespic: invalid filter");
  const peak = filter === "peak" || filter === "1";
  const colors = (options.colors ?? "red|green|blue|yellow|orange|lime|0xffc0cb|magenta|0xa52a2a").split("|");
  const channels = audio.channelData;
  const count = channels[0]?.length ?? 0;
  if (!count) throw new Error("showwavespic: no audio samples");
  const rowHeight = split ? Math.floor(height / channels.length) : height;
  if (!rowHeight) throw new Error("showwavespic: image height is smaller than the channel count");
  budget.recordFrame(width, height);
  budget.allocateMemory(width * height * 4);
  const data = new Uint8Array(width * height * 4);
  let work = 0;
  for (const [channel, samples] of channels.entries()) {
    const color = parseColorRgba(colors[Math.min(channel, colors.length - 1)]!);
    if (!split) for (let c = 0; c < 4; c++) color[c] = Math.floor(color[c]! / channels.length);
    for (let x = 0; x < width; x++) {
      const start = Math.floor(x * count / width);
      const end = Math.floor((x + 1) * count / width);
      let magnitude = 0;
      for (let i = start; i < end; i++) {
        if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        const value = Math.abs(samples[i]!);
        magnitude = peak ? Math.max(magnitude, value) : magnitude + value;
      }
      if (!peak) magnitude /= Math.max(1, end - start);
      const size = Math.min(rowHeight, Math.round(magnitude * rowHeight));
      const top = (split ? channel * rowHeight : 0) + Math.floor((rowHeight - size) / 2);
      for (let y = top; y < top + size; y++) {
        if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        const offset = (y * width + x) * 4;
        for (let c = 0; c < 4; c++) data[offset + c] = data[offset + c]! + color[c]!;
      }
    }
  }
  return { width: width, height: height, data, ptsSeconds: 0, durationSeconds: 1, keyframe: true };
}

function parseChannelSplit(spec: string): { input: string[]; selected: string[] } {
  const equals = spec.indexOf("=");
  let layout = "stereo";
  let channels = "all";
  const options = equals < 0 ? [] : spec.slice(equals + 1).split(":");
  for (const [index, option] of options.entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["channel_layout", "channels"][index] : option.slice(0, separator);
    const value = separator < 0 ? option : option.slice(separator + 1);
    if (key === "channel_layout") layout = value;
    else if (key === "channels") channels = value;
    else throw new Error(`channelsplit: unsupported option ${key}`);
  }
  const input = parseAudioChannelLayout(layout);
  if (!["FC", "FL+FR", "FL+FR+FC+LFE+BL+BR"].includes(input.join("+"))) {
    throw new Error(`channelsplit: unsupported channel layout ${layout}`);
  }
  const selected = channels === "all" ? input : parseAudioChannelLayout(channels);
  if (selected.some(channel => !input.includes(channel))) {
    throw new Error(`channelsplit: invalid channels ${channels}`);
  }
  return { input, selected };
}

async function panAudio(
  spec: string, channels: MediaAudioData["channelData"], channelMask: number | undefined, sampleFormat: string,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<{ channels: (Float32Array | Float64Array)[]; channelMask: number; channelNames: string[] }> {
  const [layout, ...assignments] = spec.split("|").map(value => value.trim());
  const count = parseAudioChannelCount(layout ?? "");
  const names = count === undefined ? parseAudioChannelLayout(layout ?? "") : Array<string>(count).fill("");
  if (count === undefined &&
      (names.some(name => audioSpeakerMasks[name] === undefined) || new Set(names).size !== names.length)) {
    throw new Error(`pan: unsupported output layout ${layout}`);
  }
  if (names.some((name, index) => index > 0 && audioSpeakerMasks[name]! < audioSpeakerMasks[names[index - 1]!]!)) {
    throw new Error(`pan: unsupported output channel order ${layout}`);
  }
  const speakers = Object.keys(audioSpeakerMasks);
  // Default layouts are mono, stereo, 2.1, 4.0, 5.0, 5.1, 6.1 and 7.1.
  // An explicit mask takes precedence; four unmasked channels are not quad.
  const inputMask = channelMask || ([0, 0x4, 0x3, 0xb, 0x107, 0x37, 0x3f, 0x70f, 0x63f][channels.length] ?? 0);
  const inputNames = speakers.filter(name => Math.floor(inputMask / audioSpeakerMasks[name]!) % 2 === 1);
  const channelIndex = (name: string, labels: string[], count: number) => {
    const index = name.startsWith("c") && name.length > 1 &&
      [...name.slice(1)].every(char => char >= "0" && char <= "9")
      ? Number(name.slice(1)) : labels.indexOf(name);
    if (!name || !Number.isInteger(index) || index < 0 || index >= count) throw new Error(`pan: invalid channel ${name}`);
    return index;
  };
  const gains = names.map(() => new Float64Array(channels.length));
  const assigned = new Set<number>();
  let numberedInputs: boolean | undefined;
  for (const assignment of assignments) {
    if (assignment === "") continue;
    const normalize = assignment.includes("<");
    const parts = assignment.split(normalize ? "<" : "=");
    if (parts.length !== 2 || !parts[1]?.trim()) throw new Error("pan: invalid channel assignment");
    const output = channelIndex(parts[0]!.trim(), names, names.length);
    if (assigned.has(output)) throw new Error("pan: duplicate output channel");
    assigned.add(output);
    const referenced = new Set<number>();
    const expression = parts[1];
    let offset = 0;
    let sign = 1;
    while (true) {
      while (expression[offset]?.trim() === "") offset++;
      const gainStart = offset;
      if (expression[offset] === "+" || expression[offset] === "-") offset++;
      const special = ["infinity", "inf", "nan"].find(value =>
        expression.slice(offset, offset + value.length).toLowerCase() === value);
      const hexadecimal = expression[offset] === "0" && expression[offset + 1]?.toLowerCase() === "x";
      if (hexadecimal) offset += 2;
      const digitsStart = offset;
      while (offset < expression.length &&
        ((expression[offset]! >= "0" && expression[offset]! <= "9") || expression[offset] === "." ||
          (hexadecimal && "abcdef".includes(expression[offset]!.toLowerCase())))) offset++;
      const digitsEnd = offset;
      let exponent = 0;
      if (offset > gainStart && expression[offset]?.toLowerCase() === (hexadecimal ? "p" : "e")) {
        const exponentStart = ++offset;
        if (expression[offset] === "+" || expression[offset] === "-") offset++;
        const exponentDigits = offset;
        while (offset < expression.length && expression[offset]! >= "0" && expression[offset]! <= "9") offset++;
        if (offset > exponentDigits) exponent = Number(expression.slice(exponentStart, offset));
      }
      if (special) offset += special.length;
      const hasGain = offset > gainStart;
      let gain = sign * (hasGain ? Number(expression.slice(gainStart, offset)) : 1);
      if (hexadecimal) {
        const [integer, fraction = "", ...extra] = expression.slice(digitsStart, digitsEnd).split(".");
        if ((!integer && !fraction) || extra.length) throw new Error("pan: invalid gain");
        let fractional = 0;
        for (let digit = fraction.length - 1; digit >= 0; digit--) {
          fractional = (fractional + parseInt(fraction[digit]!, 16)) / 16;
        }
        // scanf's hexadecimal gains use binary exponents, including an omitted exponent of zero.
        gain = sign * (expression[gainStart] === "-" ? -1 : 1) *
          (Number(`0x${integer || "0"}`) + fractional) * 2 ** exponent;
      }
      if (special && special !== "nan") gain = sign * (expression[gainStart] === "-" ? -Infinity : Infinity);
      if (!special && Number.isNaN(gain)) throw new Error("pan: invalid gain");
      while (expression[offset]?.trim() === "") offset++;
      if (hasGain && expression[offset] === "*") offset++;
      const channelStart = offset;
      while (offset < expression.length && expression[offset] !== "+" && expression[offset] !== "-") offset++;
      const inputName = expression.slice(channelStart, offset).trim();
      const input = channelIndex(inputName, speakers, 64);
      const numbered = inputName.startsWith("c");
      if (numberedInputs !== undefined && numberedInputs !== numbered) {
        throw new Error("pan: cannot mix named and numbered input channels");
      }
      numberedInputs = numbered;
      if (referenced.has(input)) throw new Error(`pan: Can not reference in channel ${input} twice`);
      referenced.add(input);
      const source = numbered ? input : inputNames.indexOf(inputName);
      if (source >= 0 && source < channels.length) gains[output]![source] = gain;
      if (offset === expression.length) break;
      sign = expression[offset] === "-" ? -1 : 1;
      offset++;
    }
    if (normalize) {
      const total = gains[output]!.reduce((sum, gain) => sum + Math.abs(gain), 0);
      if (total > 1e-5) {
        for (let input = 0; input < channels.length; input++) gains[output]![input] = gains[output]![input]! / total;
      }
    }
  }
  // Pure channel selection must retain the source sample precision.
  if (gains.every(row => row.every(gain => gain === 0 || gain === 1) &&
      row.filter(gain => gain === 1).length <= 1)) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    budget.checkCpu();
    return {
      channels: gains.map(row => {
        const source = channels[row.indexOf(1)];
        budget.allocateMemory(source?.byteLength ?? (channels[0]?.length ?? 0) * Float32Array.BYTES_PER_ELEMENT);
        return source ? source.slice() : new Float32Array(channels[0]?.length ?? 0);
      }),
      channelNames: names,
      channelMask: names.reduce((mask, name) => mask + (audioSpeakerMasks[name] ?? 0), 0)
    };
  }
  const pcm16 = sampleFormat === "s16";
  const double = sampleFormat === "dbl" || sampleFormat === "dblp";
  let clipPcm16 = false;
  if (pcm16) {
    for (const row of gains) {
      let remainder = 0;
      let sum = 0;
      for (let input = 0; input < row.length; input++) {
        // libswresample carries coefficient error across each Q15 matrix row.
        const target = row[input]! * 32768 + remainder;
        const quantized = roundToEven(Math.fround(target)) | 0;
        remainder += target - quantized;
        sum = (sum + Math.abs(quantized)) | 0;
        if (row[input] !== 0) row[input] = quantized;
      }
      clipPcm16 ||= sum > 32768;
    }
  } else if (!double) {
    // libswresample stores single-precision mix coefficients as floats.
    for (const row of gains) {
      for (let input = 0; input < row.length; input++) row[input] = Math.fround(row[input]!);
    }
  }
  const SampleArray = double ? Float64Array : Float32Array;
  budget.allocateMemory(gains.length * (channels[0]?.length ?? 0) * SampleArray.BYTES_PER_ELEMENT);
  const output = gains.map(() => new SampleArray(channels[0]?.length ?? 0));
  for (let sample = 0; sample < (channels[0]?.length ?? 0); sample++) {
    if (sample % 4096 === 0) {
      await yieldTurn(signal);
      signal?.throwIfAborted();
      budget.checkCpu();
    }
    for (let out = 0; out < output.length; out++) {
      let value = 0;
      for (let input = 0; input < channels.length; input++) {
        // Zero-gain inputs must not contaminate selected channels with NaN.
        if (gains[out]![input] === 0) continue;
        value = pcm16
          ? value + Math.imul(channels[input]![sample]! * 32768, gains[out]![input]!)
          : double ? value + channels[input]![sample]! * gains[out]![input]!
          : Math.fround(value + Math.fround(channels[input]![sample]! * gains[out]![input]!));
      }
      if (pcm16) {
        // Native PCM16 products and the rounding bias wrap before shifting.
        value = (value + 16384) >> 15;
        value = clipPcm16 ? Math.max(-32768, Math.min(32767, value)) : (value << 16) >> 16;
        value /= 32768;
      } else if (sampleFormat === "s32" || sampleFormat === "s32p") {
        // Integer pan saturates before a downstream filter can reduce the gain.
        value = Math.max(-1, Math.min(2147483647 / 2147483648, value));
      }
      output[out]![sample] = value;
    }
  }
  return { channels: output, channelNames: names,
    channelMask: names.reduce((mask, name) => mask + (audioSpeakerMasks[name] ?? 0), 0) };
}

function parseAmergeInputs(filter: string): number {
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  let count = 2;
  const options = argument ? argument.split(":") : [];
  if (options.at(-1) === "") options.pop();
  for (const [index, option] of options.entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? (index === 0 ? "inputs" : undefined) : option.slice(0, separator).trim();
    if (key !== "inputs") throw new Error("amerge: unsupported option");
    const value = parseFilterExpression(separator < 0 ? option : option.slice(separator + 1),
      "amerge", { E: Math.E, PI: Math.PI, PHI: (1 + Math.sqrt(5)) / 2, min: 1, max: 64, default: 2 });
    if (value < 1 || value > 64) throw new Error("amerge: inputs out of range");
    // AVOption integers validate each assignment before rounding, with ties to even.
    const lower = Math.floor(value);
    count = value - lower === 0.5 ? lower + lower % 2 : Math.round(value);
  }
  return count;
}

function parseAstreamselectOptions(filter: string): { count: number; selected: number } {
  let count = 2;
  let selected = NaN;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["inputs", "map"][index] : option.slice(0, separator);
    const raw = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "inputs") {
      const value = parseFilterExpression(raw, "astreamselect", {});
      if (value < 2 || value > 2147483647) throw new Error("astreamselect: inputs out of range");
      // AVOption integers validate the range before rounding, with ties to even.
      const lower = Math.floor(value);
      count = value - lower === 0.5 ? lower + lower % 2 : Math.round(value);
    } else if (key === "map") {
      // FFmpeg consumes base-zero strtol prefixes, stopping at a non-integer suffix.
      const integer = /^[\t\n\v\f\r ]*([+-]?)(0[xX][\da-fA-F]+|0[0-7]*|[1-9]\d*)/;
      const match = integer.exec(raw);
      if (!match || integer.test(raw.slice(match[0].length))) {
        throw new Error("astreamselect: map must select one connected input");
      }
      const digits = match[2]!;
      const radix = digits.toLowerCase().startsWith("0x") ? 16 : digits.startsWith("0") ? 8 : 10;
      selected = Number.parseInt(digits, radix) * (match[1] === "-" ? -1 : 1);
    }
    else throw new Error(`astreamselect: unsupported option ${key}`);
  }
  if (!Number.isInteger(selected) || selected < 0 || selected >= count) {
    throw new Error("astreamselect: map must select one connected input");
  }
  return { count, selected };
}

// Resolve audio graph inputs and transitions before the PCM filter evaluator runs.
async function resolveAudioGraph(graph: string, docs: MediaDocument[], maps: string[], outputMaps: Set<string>, mappedLabels: Set<string>, filterAudio: (track: MediaTrack, expression: string) => Promise<MediaTrack>, budget: MediaBudgetTracker, signal?: AbortSignal) {
  const nodes = new Map<string, { inputs: string[]; expression: string }>();
  const inputTrack = (label: string): MediaTrack => {
    const [input, selector, ordinal, ...extra] = label.split(":");
    const numeric = selector === "a" ? [input, ordinal ?? "0"] : [input, selector ?? "0"];
    const valid = extra.length === 0 && (selector === "a" || ordinal === undefined) &&
      numeric.every(value => value !== undefined && value.length > 0 &&
        Array.from(value).every(char => char >= "0" && char <= "9") && Number.isSafeInteger(Number(value)));
    const tracks = valid ? docs[Number(input)]?.tracks : undefined;
    const track = selector === undefined || selector === "a"
      ? tracks?.filter(track => track.type === "audio")[Number(ordinal ?? "0")]
      : tracks?.[Number(selector)];
    if (!track || track.type !== "audio") throw new Error(`Invalid audio filter input: ${label}`);
    return track;
  };
  const consumed = new Set<string>();
  const reused = new Set<string>();
  const sinks: string[] = [];
  const unlabeled: string[] = [];
  let start = 0;
  let quoted = false;
  const chains: string[] = [];
  for (let i = 0; i <= graph.length; i++) {
    const char = graph[i];
    if (char === "'") quoted = !quoted;
    else if (!quoted && char === "\\") i++;
    else if (i === graph.length || (!quoted && char === ";")) {
      chains.push(graph.slice(start, i).trim());
      start = i + 1;
    }
  }
  for (const chain of chains) {
    const inputs: string[] = [];
    let inputEnd = -1;
    while (chain[inputEnd + 1] === "[") {
      const end = chain.indexOf("]", inputEnd + 1);
      if (end < 0) throw new Error("Invalid audio filter input label");
      inputs.push(chain.slice(inputEnd + 2, end));
      inputEnd = end;
    }
    const outputs: string[] = [];
    let outputStart = chain.length;
    while (chain[outputStart - 1] === "]") {
      const labelStart = chain.lastIndexOf("[", outputStart - 1);
      if (labelStart <= inputEnd) break;
      outputs.unshift(chain.slice(labelStart + 1, outputStart - 1));
      outputStart = labelStart;
    }
    let expression = chain.slice(inputEnd + 1, outputStart).trim();
    if (!expression || expression.startsWith("[")) {
      throw new Error("Unsupported audio filter graph");
    }
    const filters = parseFilterChain(expression);
    const last = filters.at(-1)!;
    const split = last === "channelsplit" || last.startsWith("channelsplit=") || last.startsWith("channelsplit@") ? parseChannelSplit(last) : undefined;
    const sink = last.split("=", 1)[0]!.split("@", 1)[0] === "anullsink";
    let outputCount = sink ? 0 : split?.selected.length ?? 1;
    if (sink) {
      if (last.includes("=") && last.indexOf("=") !== last.length - 1) throw new Error("anullsink does not accept options");
      // Internal sink nodes run through the same evaluator, but never become output streams.
      const label = `\0sink${sinks.length}`;
      sinks.push(label);
      nodes.set(label, { inputs, expression: serializeFilterChain(filters.slice(0, -1)) || "anull" });
    }
    if (last === "asplit" || last.startsWith("asplit=")) {
      const argument = last.slice("asplit=".length);
      const count = argument.startsWith("outputs=") ? argument.slice("outputs=".length) : argument;
      outputCount = last === "asplit" ? 2 : Number(count);
      if (!Number.isInteger(outputCount) || outputCount < 1) throw new Error("asplit: outputs must be a positive integer");
      // Duplicate the source and preceding filters; each branch applies its own downstream filters.
      expression = serializeFilterChain(filters.slice(0, -1)) || "anull";
    }
    if (!outputs.length) {
      for (let index = 0; index < outputCount; index++) {
        const label = `\0${unlabeled.length}`;
        unlabeled.push(label);
        outputs.push(label);
      }
    }
    if (outputs.length !== outputCount) throw new Error("Audio filter output label count does not match filter outputs");
    for (const [index, output] of outputs.entries()) {
      if (!output || nodes.has(output)) throw new Error("Duplicate or empty audio filter output");
      // Each graph edge evaluates the preceding chain, then selects its own PCM channel.
      const selected = split ? expression + (last.includes("=") ? ":" : "=") + `channels=${split.selected[index]}` : expression;
      nodes.set(output, { inputs, expression: selected });
    }
    for (const input of inputs) {
      if (consumed.has(input)) reused.add(input);
      consumed.add(input);
    }
  }
  const usedInputs = new Set<MediaTrack>();
  for (const { inputs, expression } of nodes.values()) {
    for (const input of inputs) if (!nodes.has(input)) usedInputs.add(inputTrack(input));
    const filter = parseFilterChain(expression)[0]!;
    const first = filter.split("=", 1)[0]?.split("@", 1)[0];
    const inputCount = first === "amerge" ? parseAmergeInputs(filter)
      : first === "astreamselect" ? parseAstreamselectOptions(filter).count : first === "acrossfade" ? 2 : 1;
    if (first === "amerge" && inputs.length > inputCount) {
      throw new Error(`amerge requires ${inputCount} inputs (inputs=${inputCount})`);
    }
    // Split outputs share this input list; bind it once, before output mapping order matters.
    while (inputs.length < inputCount) {
      let connected = false;
      for (const [input, doc] of docs.entries()) {
        const ordinal = doc.tracks.findIndex(track => track.type === "audio" && !usedInputs.has(track));
        if (ordinal < 0) continue;
        inputs.push(`${input}:${ordinal}`);
        usedInputs.add(doc.tracks[ordinal]!);
        connected = true;
        break;
      }
      if (!connected) throw new Error("No available stream for unlabeled audio filter input");
    }
  }
  const resolve = async (label: string, visiting = new Set<string>()): Promise<{ track: MediaTrack; expression: string }> => {
    if (visiting.has(label)) throw new Error("Audio filter graph contains a cycle");
    const node = nodes.get(label);
    if (node) {
      visiting.add(label);
      const sources = [];
      for (const input of node.inputs) sources.push(await resolve(input, new Set(visiting)));
      const filters = parseFilterChain(node.expression);
      const first = filters[0]!;
      const equals = first.indexOf("=");
      const instance = first.indexOf("@");
      if (instance >= 0 && (equals < 0 || instance < equals)) {
        filters[0] = first.slice(0, instance) + (equals < 0 ? "" : first.slice(equals));
      }
      if (filters[0] === "headphone" || filters[0]?.startsWith("headphone=")) {
        if (sources.some(source => source.expression && source.expression !== "anull")) {
          throw new Error("headphone does not support preceding single-input filters");
        }
        const track = await headphoneAudio(sources.map(source => source.track), filters[0]!, budget, signal);
        return { track, expression: filters.slice(1).join(",") || "anull" };
      }
      if (filters[0] === "amultiply" || filters[0]?.startsWith("amultiply=") || filters[0]?.startsWith("amultiply@")) {
        if (filters[0].includes("=")) throw new Error("amultiply does not accept options");
        if (sources.length !== 2) throw new Error("amultiply requires two inputs");
        for (const source of sources) {
          if (source.expression && source.expression !== "anull") {
            source.track = await filterAudio(source.track, source.expression);
          }
        }
        const first = sources[0]!.track;
        const a = first.decodedAudio;
        const b = sources[1]!.track.decodedAudio;
        if (!a || !b) throw new Error("amultiply requires decoded PCM audio");
        const layoutA = a.channelMask || (a.channels === 1 ? 4 : a.channels === 2 ? 3 : undefined);
        const layoutB = b.channelMask || (b.channels === 1 ? 4 : b.channels === 2 ? 3 : undefined);
        const remix = a.channels !== b.channels &&
          (layoutA === 4 && layoutB === 3 || layoutA === 3 && layoutB === 4);
        if (!remix && (a.channels !== b.channels || layoutA !== layoutB)) {
          throw new Error("amultiply requires matching layouts or mono/stereo inputs");
        }
        let multiplier = b.channelData;
        if (a.sampleRate !== b.sampleRate) {
          const resampledLength = Math.ceil(b.channelData[0]!.length * a.sampleRate / b.sampleRate);
          budget.checkSamples(resampledLength);
          budget.checkDuration(resampledLength / a.sampleRate);
          budget.allocateMemory(resampledLength * b.channels * Float32Array.BYTES_PER_ELEMENT);
          multiplier = await resampleAudio(b.channelData, resampledLength, b.sampleRate, a.sampleRate, budget, signal);
        }
        const length = Math.min(a.channelData[0]!.length, multiplier[0]!.length);
        budget.checkSamples(length);
        budget.checkDuration(length / a.sampleRate);
        budget.allocateMemory(length * a.channels * 8);
        const channelData = a.channelData.map(() => new Float64Array(length));
        for (let channel = 0; channel < a.channels; channel++) {
          for (let sample = 0; sample < length; sample++) {
            if (sample % 4096 === 0) {
              await yieldTurn(signal);
              signal?.throwIfAborted();
              budget.checkCpu();
            }
            // amultiply negotiates floating PCM, so rematrix at equal power without PCM16 normalization.
            const gain = remix ? (b.channels === 1 ? multiplier[0]![sample]!
              : multiplier[0]![sample]! + multiplier[1]![sample]!) * Math.SQRT1_2 : multiplier[channel]![sample]!;
            channelData[channel]![sample] = a.channelData[channel]![sample]! * gain;
          }
        }
        return { track: { ...first, timescale: a.sampleRate, duration: length, samples: [], editList: undefined,
          decodedAudio: { ...a, channelData } }, expression: serializeFilterChain(filters.slice(1)) || "anull" };
      }
      if (filters[0] === "sidechaingate" || filters[0]?.startsWith("sidechaingate=")) {
        if (sources.length !== 2) throw new Error("sidechaingate requires two inputs");
        for (const source of sources) {
          if (source.expression && source.expression !== "anull") {
            source.track = await filterAudio(source.track, source.expression);
          }
        }
        const first = sources[0]!.track;
        const a = first.decodedAudio;
        const b = sources[1]!.track.decodedAudio;
        if (!a || !b) throw new Error("sidechaingate requires decoded PCM audio");
        let control = b.channelData;
        if (a.sampleRate !== b.sampleRate) {
          const length = Math.ceil(b.channelData[0]!.length * a.sampleRate / b.sampleRate);
          budget.checkSamples(length);
          budget.checkDuration(length / a.sampleRate);
          budget.allocateMemory(length * b.channels * Float32Array.BYTES_PER_ELEMENT);
          control = await resampleAudio(b.channelData, length, b.sampleRate, a.sampleRate, budget, signal);
        }
        return { track: await gateAudio(first, filters[0]!, budget, control, signal),
          expression: serializeFilterChain(filters.slice(1)) || "anull" };
      }
      if (filters[0] === "sidechaincompress" || filters[0]?.startsWith("sidechaincompress=")) {
        if (sources.length !== 2) throw new Error("sidechaincompress requires two inputs");
        for (const source of sources) {
          if (source.expression && source.expression !== "anull") {
            source.track = await filterAudio(source.track, source.expression);
          }
        }
        const first = sources[0]!.track;
        const a = first.decodedAudio;
        const b = sources[1]!.track.decodedAudio;
        if (!a || !b) throw new Error("sidechaincompress requires decoded PCM audio");
        let detector = b.channelData;
        if (a.sampleRate !== b.sampleRate) {
          const length = Math.ceil(b.channelData[0]!.length * a.sampleRate / b.sampleRate);
          budget.checkSamples(length);
          budget.checkDuration(length / a.sampleRate);
          budget.allocateMemory(length * b.channels * Float32Array.BYTES_PER_ELEMENT);
          detector = await resampleAudio(b.channelData, length, b.sampleRate, a.sampleRate, budget, signal);
        }
        const channelData = await compressAudio(a.channelData, a.sampleRate, filters[0]!, budget, signal, detector);
        const length = channelData[0]!.length;
        const frames: MediaTrack["samples"][number][] = [];
        const cursors = sources.map(() => ({ index: 0, end: 0 }));
        // The compressor drains both input FIFOs at each frame boundary and starts its output clock at zero.
        for (let start = 0; start < length;) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
          for (const [input, cursor] of cursors.entries()) {
            const track = sources[input]!.track;
            while (cursor.end <= start) {
              const packet = track.samples[cursor.index++];
              cursor.end += packet ? Math.max(0, Math.round(packet.duration * a.sampleRate / track.timescale)
                - (packet.skipSamples ?? 0) - (packet.discardPadding ?? 0)) : 1024;
              budget.checkCpu();
            }
          }
          const end = Math.min(length, ...cursors.map(cursor => cursor.end));
          budget.allocateMemory(96);
          frames.push({ data: new Uint8Array(0), size: 0, pts: start, dts: start, cts: 0,
            duration: end - start, isKeyframe: true, sampleDescriptionIndex: 1 });
          start = end;
        }
        return { track: { ...first, timescale: a.sampleRate, duration: length, samples: frames, editList: undefined,
          decodedAudio: { ...a, channelData } }, expression: serializeFilterChain(filters.slice(1)) || "anull" };
      }
      if (filters[0] === "astreamselect" || filters[0]?.startsWith("astreamselect=")) {
        const { count, selected } = parseAstreamselectOptions(filters[0]);
        if (count !== sources.length) {
          throw new Error("astreamselect: inputs must match the number of connected inputs (at least two)");
        }
        for (const source of sources) {
          if (source.expression && source.expression !== "anull") {
            source.track = await filterAudio(source.track, source.expression);
          }
        }
        if (sources.some(source => !source.track.decodedAudio)) {
          throw new Error("astreamselect requires decoded PCM inputs");
        }
        const sampleRate = sources[0]!.track.decodedAudio!.sampleRate;
        for (const source of sources) {
          if (source.track.decodedAudio!.sampleRate !== sampleRate) {
            source.track = await resampleStreamselectInput(source.track, sampleRate, budget, signal);
          }
        }
        const track = sources[selected]!.track;
        const audio = track.decodedAudio!;
        // Framesync waits for every input to start and stops just after the
        // earliest final packet timestamp. It forwards whole selected frames.
        let firstPts = -Infinity;
        let lastPts = Infinity;
        for (const { track: input } of sources) {
          budget.checkCpu();
          const length = input.decodedAudio!.channelData[0]!.length;
          firstPts = Math.max(firstPts, length === 0 ? Infinity :
            (input.samples[0]?.pts ?? 0) / input.timescale);
          lastPts = Math.min(lastPts, length === 0 ? -Infinity : input.samples.length
            ? input.samples.at(-1)!.pts / input.timescale : (length - 1) / audio.sampleRate);
        }
        let start = 0;
        let end = 0;
        let firstPacket = 0;
        let lastPacket = 0;
        if (firstPts <= lastPts) {
          for (let position = 0, index = 0; position < audio.channelData[0]!.length; index++) {
            if (index % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            const packet = track.samples[index];
            const count = packet ? Math.max(0, Math.round(packet.duration * audio.sampleRate / track.timescale)
              - (packet.skipSamples ?? 0) - (packet.discardPadding ?? 0)) : 1024;
            if (count === 0) continue;
            const pts = packet ? packet.pts / track.timescale : position / audio.sampleRate;
            if (pts > lastPts) break;
            if (pts <= firstPts) { start = position; firstPacket = index; }
            lastPacket = index + 1;
            end = Math.min(audio.channelData[0]!.length, position + count);
            position = end;
          }
        }
        const length = end - start;
        budget.checkSamples(length);
        budget.checkDuration(length / audio.sampleRate);
        const target = sources[0]!.track.decodedAudio!;
        const inputLayout = audio.channelMask || (audio.channels === 1 ? 4 : audio.channels === 2 ? 3 : undefined);
        const targetLayout = target.channelMask || (target.channels === 1 ? 4 : target.channels === 2 ? 3 : undefined);
        let channelData = audio.channelData.map(channel => channel.subarray(start, end));
        if (audio.channels !== target.channels || inputLayout !== targetLayout) {
          if (!(inputLayout === 4 && targetLayout === 3 || inputLayout === 3 && targetLayout === 4)) {
            throw new Error("astreamselect requires matching layouts or mono/stereo inputs");
          }
          const expression = target.channels === 1 ? "mono|c0=0.5*c0+0.5*c1"
            : `stereo|c0=${Math.SQRT1_2}*c0|c1=${Math.SQRT1_2}*c0`;
          const pcm16 = ["pcm_s16le", "pcm_s16be"].includes(track.codecDescriptions[0]?.codecName ?? "");
          const sampleFormat = pcm16 ? "s16" : ["pcm_s24le", "pcm_s32le"].includes(track.codecDescriptions[0]?.codecName ?? "") ? "s32" : "flt";
          const mixed = await panAudio(expression, channelData, inputLayout, sampleFormat, budget, signal);
          channelData = mixed.channels;
        }
        budget.allocateMemory(Math.max(0, Math.min(lastPacket, track.samples.length) - firstPacket) * 8);
        return { track: { ...track, duration: length * track.timescale / audio.sampleRate,
          samples: track.samples.slice(firstPacket, lastPacket), editList: undefined,
          decodedAudio: { ...audio, channels: target.channels, channelMask: targetLayout, channelData } },
          expression: serializeFilterChain(filters.slice(1)) || "anull" };
      }
      if (filters[0] === "axcorrelate" || filters[0]?.startsWith("axcorrelate=")) {
        if (sources.length !== 2) throw new Error("axcorrelate requires two inputs");
        for (const source of sources) {
          if (source.expression && source.expression !== "anull") {
            source.track = await filterAudio(source.track, source.expression);
          }
        }
        const track = await correlateAudio(sources[0]!.track, sources[1]!.track, filters[0]!, budget, signal);
        return { track, expression: serializeFilterChain(filters.slice(1)) || "anull" };
      }
      if (filters[0] === "amix" || filters[0]?.startsWith("amix=")) {
        for (const source of sources) {
          if (source.expression && source.expression !== "anull") {
            source.track = await filterAudio(source.track, source.expression);
          }
        }
        const track = await mixAudio(sources.map(source => source.track), filters[0]!, budget, signal);
        return { track, expression: serializeFilterChain(filters.slice(1)) || "anull" };
      }
      if (filters[0] === "acrossfade" || filters[0]?.startsWith("acrossfade=")) {
        if (sources.length !== 2) throw new Error("acrossfade requires two inputs");
        for (const source of sources) {
          if (source.expression && source.expression !== "anull") {
            source.track = await filterAudio(source.track, source.expression);
          }
        }
        const track = await acrossfadeAudio(sources[0]!.track, sources[1]!.track, filters[0]!, budget, signal);
        return { track, expression: serializeFilterChain(filters.slice(1)) || "anull" };
      }
      if (filters[0] === "amerge" || filters[0]?.startsWith("amerge=")) {
        for (const source of sources) {
          if (source.expression && source.expression !== "anull") {
            source.track = await filterAudio(source.track, source.expression);
          }
        }
        const first = sources[0]!.track;
        const audio = sources.map(source => {
          if (!source.track.decodedAudio) throw new Error("amerge requires decoded PCM audio");
          return source.track.decodedAudio;
        });
        const a = audio[0]!;
        if (audio.reduce((count, input) => count + input.channels, 0) > 64) {
          throw new Error("amerge supports at most 64 output channels");
        }
        for (let index = 1; index < audio.length; index++) {
          const input = audio[index]!;
          if (input.sampleRate === a.sampleRate) continue;
          const length = Math.ceil(input.channelData[0]!.length * a.sampleRate / input.sampleRate);
          budget.checkSamples(length);
          budget.checkDuration(length / a.sampleRate);
          budget.allocateMemory(length * input.channels * Float32Array.BYTES_PER_ELEMENT);
          audio[index] = { ...input, sampleRate: a.sampleRate,
            channelData: await resampleAudio(input.channelData, length, input.sampleRate, a.sampleRate, budget, signal) };
        }
        const defaultMasks = [0, 4, 3, 0xb, 0x107, 0x37, 0x3f, 0x70f, 0x63f];
        const masks = audio.map(input => input.channelMask || defaultMasks[input.channels] || 0);
        const inputs = audio.flatMap((audio, input) => {
          const speakers = Array.from({ length: 32 }, (_, bit) => 2 ** bit)
            .filter(speaker => (masks[input]! & speaker) !== 0);
          if (speakers.length !== audio.channels) throw new Error("amerge requires known speaker layouts");
          return audio.channelData.map((samples, channel) => ({ samples, speaker: speakers[channel]! }));
        });
        let channelMask = defaultMasks[inputs.length] ?? 0;
        let combinedMask = 0;
        let overlap = false;
        for (const mask of masks) {
          overlap ||= (combinedMask & mask) !== 0;
          combinedMask |= mask;
        }
        if (!overlap) {
          inputs.sort((left, right) => left.speaker - right.speaker);
          channelMask = combinedMask >>> 0;
        }
        const length = Math.min(...audio.map(input => input.channelData[0]!.length));
        budget.checkSamples(length);
        budget.checkDuration(length / a.sampleRate);
        budget.allocateMemory(length * inputs.length * 8);
        const channelData = inputs.map(() => new Float64Array(length));
        const pcm16 = ["pcm_s16le", "pcm_s16be"].includes(first.codecDescriptions[0]?.codecName ?? "");
        for (let offset = 0; offset < length; offset += 4096) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
          for (const [channel, input] of inputs.entries()) {
            const end = Math.min(offset + 4096, length);
            if (pcm16) {
              // amerge negotiates the first input's format before downstream filters.
              for (let i = offset; i < end; i++) {
                channelData[channel]![i] = Math.max(-32768, Math.min(32767,
                  roundToEven(input.samples[i]! * 32768))) / 32768;
              }
            } else channelData[channel]!.set(input.samples.subarray(offset, end), offset);
          }
        }
        // Preserve decoded input frame boundaries and take the output
        // timestamp from the first input, including any partially consumed frame.
        const frames: MediaTrack["samples"][number][] = [];
        const cursors = sources.map(() => ({ index: 0, start: 0, end: 0, pts: 0 }));
        for (let start = 0; start < length;) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
          for (const [input, cursor] of cursors.entries()) {
            const track = sources[input]!.track;
            while (cursor.end <= start) {
              const packet = track.samples[cursor.index++];
              cursor.start = cursor.end;
              cursor.pts = packet ? Math.round(packet.pts * a.sampleRate / track.timescale)
                + (packet.skipSamples ?? 0) : cursor.start;
              cursor.end += packet ? Math.max(0, Math.round(packet.duration * a.sampleRate / track.timescale)
                - (packet.skipSamples ?? 0) - (packet.discardPadding ?? 0)) : 1024;
              budget.checkCpu();
            }
          }
          const end = Math.min(length, ...cursors.map(cursor => cursor.end));
          const pts = cursors[0]!.pts + start - cursors[0]!.start;
          budget.allocateMemory(96);
          frames.push({ data: new Uint8Array(0), size: 0, pts, dts: pts, cts: 0,
            duration: end - start, isKeyframe: true, sampleDescriptionIndex: 1 });
          start = end;
        }
        return { track: { ...first, timescale: a.sampleRate, duration: length, samples: frames, editList: undefined,
          decodedAudio: { ...a, channels: channelData.length, channelMask, channelData } },
          expression: serializeFilterChain(filters.slice(1)) || "anull" };
      }
      if (filters[0] === "join" || filters[0]?.startsWith("join=")) {
        for (const source of sources) {
          if (source.expression && source.expression !== "anull") {
            source.track = await filterAudio(source.track, source.expression);
          }
        }
        const track = await joinAudio(sources.map(source => source.track), filters, budget, signal);
        return { track, expression: serializeFilterChain(filters.slice(1)) || "anull" };
      }
      if (sources.length !== 1) throw new Error("Audio filter requires one input");
      const source = sources[0]!;
      return { track: source.track, expression: [source.expression, node.expression]
        .filter(expression => expression && expression !== "anull").join(",") || "anull" };
    }
    return { track: inputTrack(label), expression: "" };
  };
  const outputs = maps.filter(map => map.startsWith("[") && map.endsWith("]"))
    .map(map => map.slice(1, -1));
  outputs.unshift(...unlabeled.filter(label => !mappedLabels.has(label)));
  for (const label of outputs) {
    if (!nodes.has(label)) throw new Error(`Unknown audio filter output: ${label}`);
    if (consumed.has(label) || mappedLabels.has(label)) {
      throw new Error(`Audio filter output already consumed: ${label}`);
    }
    mappedLabels.add(label);
  }
  for (const label of nodes.keys()) {
    if (reused.has(label)) throw new Error(`Audio filter output already consumed: ${label}`);
    if (sinks.includes(label)) continue;
    if (!consumed.has(label) && !unlabeled.includes(label) && !outputMaps.has(`[${label}]`)) {
      throw new Error(`Audio filter has an unconnected output: ${label}`);
    }
  }
  if (maps.some(map => !map.startsWith("[") || !map.endsWith("]"))) {
    throw new Error("Unsupported audio filter output map");
  }
  if (!outputs.length && unlabeled.length && !maps.length) {
    return { outputs: selectAutomaticStreams(docs).flatMap(doc => doc.tracks)
      .filter(track => track.type === "audio").map(track => ({ track, expression: "" })),
      sinks: await Promise.all(sinks.map(label => resolve(label))) };
  }
  if (!outputs.length) throw new Error("Audio filter graph has no output");
  return { outputs: await Promise.all(outputs.map(label => resolve(label))),
    sinks: await Promise.all(sinks.map(label => resolve(label))) };
}

async function applyVideoFilterChain(
  frames: MediaVideoFrame[],
  filterChainStr: string,
  budget: MediaBudgetTracker,
  diagnostics: { sar: number; sarWidth: number; sarHeight: number; timescale: number; pixelFormat: string | undefined; logLevel: number; write: (text: string) => Promise<void> },
  readSubtitle: (filename: string) => Promise<Uint8Array>,
  registry: ReturnType<typeof createMediaAstRegistry>,
  signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  let work = 0;

  let pixelFormat = diagnostics.pixelFormat;
  let timescale = diagnostics.timescale;
  let current: (MediaVideoFrame & { filterMetadata?: Record<string, string> })[] = frames;
  if (current.length === 0) return current;

  for (const filterSpec of parseFilterChain(filterChainStr)) {
    if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

    budget.checkCpu();
    const eqIdx = filterSpec.indexOf("=");
    const name = (eqIdx >= 0 ? filterSpec.slice(0, eqIdx) : filterSpec).split("@", 1)[0]!.trim().toLowerCase();
    const argStr = eqIdx >= 0 ? filterSpec.slice(eqIdx + 1).trim() : "";
    const positional = argStr.split(":");
    const named: Record<string, string> = {};
    for (const part of positional) {
      if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

      const kIdx = part.indexOf("=");
      if (kIdx >= 0) {
        let key = part.slice(0, kIdx).trim().toLowerCase();
        if (name === "trim" && ["starti", "endi", "durationi"].includes(key)) key = key.slice(0, -1);
        named[key] = part.slice(kIdx + 1).trim();
      }
    }

    if (name === "signalstats") {
      const stat = named.stat ?? (positional[0]?.includes("=") ? "" : positional[0]) ?? "";
      const out = named.out ?? (positional[1]?.includes("=") ? undefined : positional[1]) ?? "-1";
      if (Object.keys(named).some(key => !["stat", "out", "c", "color"].includes(key)) || positional.length > 3 ||
          !["", "0", "brng", "4"].includes(stat) || !["-1", "brng", "2"].includes(out)) {
        throw new Error("signalstats: supported stat/out mode is brng");
      }
      const [r, g, b] = parseColorRgba(named.c ?? named.color ?? positional[2] ?? "yellow");
      const color = out === "-1" ? undefined : [
        (263*r + 516*g + 100*b + 512 + (16<<10)) >> 10,
        ((-152*r - 298*g + 450*b + 511) >> 10) + 128,
        ((450*r - 377*g - 73*b + 511) >> 10) + 128
      ];
      current = await signalstats(current, stat === "brng" || stat === "4", color, budget, signal);
    } else if (name === "bitplanenoise") {
      const bitplane = Number(named.bitplane ?? (positional[0]?.includes("=") ? undefined : positional[0] || undefined) ?? 1);
      const filter = named.filter ?? (positional[1]?.includes("=") ? undefined : positional[1]) ?? "0";
      if (Object.keys(named).some(key => key !== "bitplane" && key !== "filter") || positional.length > 2 ||
          !Number.isInteger(bitplane) || bitplane < 1 || bitplane > 16 ||
          !["0", "1", "true", "false", "yes", "no", "on", "off"].includes(filter)) {
        throw new Error("bitplanenoise: options must be bitplane=1..16 and filter=boolean");
      }
      const render = ["1", "true", "yes", "on"].includes(filter);
      const mask = 1 << (bitplane - 1);
      current = await mapWork(current, async f => {
        const source = f.native;
        const planar = source && source.rgba === f.data && source.width === f.width && source.height === f.height &&
          [0, 4, 5, 12, 13, 14].includes(source.format) ? source : undefined;
        const pixels = render ? new Uint8Array(planar ? planar.pixels : f.data) : undefined;
        const metadata = { ...f.filterMetadata };
        let offset = 0;
        // RGB is negotiated as planar GBR by native FFmpeg.
        for (const [plane, channel] of [1, 2, 0].entries()) {
          const width = planar && plane > 0 && [0, 4, 12, 13].includes(planar.format) ? Math.ceil(f.width / 2) : f.width;
          const height = planar && plane > 0 && [0, 12].includes(planar.format) ? Math.ceil(f.height / 2) : f.height;
          let count = 0;
          const sample = (x: number, y: number) => planar
            ? planar.pixels[offset + y * width + x]! & mask
            : f.data[(y * width + x) * 4 + channel]! & mask;
          for (let y = 0; y < height; y++) {
            if (y % 32 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            const neighborY = height === 1 ? y : y === height - 1 ? y - 1 : y + 1;
            for (let x = 0; x < width; x++) {
              const value = sample(x, y);
              const left = Math.max(0, x - 1);
              const right = Math.min(width - 1, x + 1);
              const a = sample(x === 0 ? right : left, y);
              const b = x === 0 ? sample(right, neighborY) : x === width - 1 ? sample(left, neighborY) : sample(right, y);
              const bit = Number(Number(value === a) + Number(value === b) + Number(value === sample(x, neighborY)) > 1);
              count += bit;
              if (pixels) pixels[planar ? offset + y * width + x : (y * width + x) * 4 + channel] = 255 * bit;
            }
          }
          metadata[`lavfi.bitplanenoise.${plane}.${bitplane}`] = (1 - 2 * Math.abs(Math.fround(count / (width * height)) - 0.5)).toFixed(6);
          offset += width * height;
        }
        if (pixels && planar) {
          const native = { ...planar, pixels };
          const data = scaleVideoPicture({ ...f, native }, f.width, f.height)!;
          return { ...f, data, native: { ...native, rgba: data }, filterMetadata: metadata };
        }
        return { ...f, data: pixels ?? f.data, filterMetadata: metadata };
      }, signal);
    } else if (name === "metadata") {
      const mode = named.mode ?? positional[0];
      if (mode !== "print" || Object.keys(named).some(key => key !== "mode" && key !== "key") ||
          positional.some((part, index) => index > 0 && !part.includes("="))) {
        throw new Error("metadata: only print mode and key selection are supported");
      }
      if (diagnostics.logLevel < 32) continue;
      for (const [index, frame] of current.entries()) {
        const entries = Object.entries(frame.filterMetadata ?? {}).filter(([key]) => !named.key || key === named.key);
        if (!entries.length) continue;
        await diagnostics.write(`frame:${index} pts:${Math.round(frame.ptsSeconds * diagnostics.timescale)} pts_time:${frame.ptsSeconds}\n` +
          entries.map(([key, value]) => `${key}=${value}\n`).join(""));
      }
    } else if (name === "showinfo") {
      const option = named.checksum ?? positional[0];
      if (positional.length > 1 || Object.keys(named).some(key => key !== "checksum") ||
          (argStr && !["0", "1", "true", "false", "yes", "no", "on", "off"].includes(option!))) {
        throw new Error("showinfo: checksum must be a boolean");
      }
      if (diagnostics.logLevel < 32) continue;
      const checksumEnabled = !["0", "false", "no", "off"].includes(option ?? "");
      for (const [n, frame] of current.entries()) {
        budget.checkCpu();
        let format = diagnostics.pixelFormat ?? "rgba";
        let planes: Uint8Array[];
        const native = frame.native;
        if (native && native.rgba === frame.data && native.width === frame.width && native.height === frame.height &&
            [0, 4, 5, 12, 13, 14].includes(native.format)) {
          format = ({ 0: "yuv420p", 4: "yuv422p", 5: "yuv444p", 12: "yuvj420p", 13: "yuvj422p", 14: "yuvj444p" } as Record<number, string>)[native.format]!;
          const luma = frame.width * frame.height;
          const chroma = Math.ceil(frame.width / ([5, 14].includes(native.format) ? 1 : 2)) *
            Math.ceil(frame.height / ([0, 12].includes(native.format) ? 2 : 1));
          planes = [native.pixels.subarray(0, luma), native.pixels.subarray(luma, luma + chroma), native.pixels.subarray(luma + chroma, luma + 2 * chroma)];
        } else {
          const channels = ({ rgb24: [0, 1, 2], bgr24: [2, 1, 0], rgba: [0, 1, 2, 3], bgra: [2, 1, 0, 3], gray: [0], ya8: [0, 3] } as Record<string, number[]>)[format];
          if (!channels) format = "rgba";
          if (!channels || format === "rgba") planes = [frame.data];
          else {
            const packed = new Uint8Array(frame.width * frame.height * channels.length);
            for (let pixel = 0; pixel < frame.width * frame.height; pixel++) {
              if (pixel % 4096 === 0) { await yieldTurn(signal); budget.checkCpu(); }
              for (const [j, channel] of channels.entries()) packed[pixel * channels.length + j] = frame.data[pixel * 4 + channel]!;
            }
            planes = [packed];
          }
        }
        let stats = "";
        if (checksumEnabled) {
          let a = 0, b = 0;
          const checksums: string[] = [], means: number[] = [], deviations: string[] = [];
          const hex = (value: number) => (value >>> 0).toString(16).padStart(8, "0").toUpperCase();
          for (const plane of planes) {
            let pa = 0, pb = 0, sum = 0, squares = 0;
            for (let i = 0; i < plane.length; i++) {
              if (i % 4096 === 0) { await yieldTurn(signal); budget.checkCpu(); }
              const value = plane[i]!;
              a = (a + value) % 65521; b = (b + a) % 65521;
              pa = (pa + value) % 65521; pb = (pb + pa) % 65521;
              sum += value; squares += value * value;
            }
            checksums.push(hex(pb * 65536 + pa));
            means.push(Math.round(sum / plane.length));
            deviations.push(Math.sqrt(Math.max(0, squares / plane.length - (sum / plane.length) ** 2)).toFixed(1));
          }
          stats = ` checksum:${hex(b * 65536 + a)} plane_checksum:[${checksums.join(" ")}] mean:[${means.join(" ")}] stdev:[${deviations.join(" ")}]`;
        }
        await diagnostics.write(`[showinfo] n:${n} pts:${Math.round(frame.ptsSeconds * diagnostics.timescale)} pts_time:${Number(frame.ptsSeconds.toPrecision(6))} duration:${Math.round(frame.durationSeconds * diagnostics.timescale)} duration_time:${Number(frame.durationSeconds.toPrecision(6))} fmt:${format} s:${frame.width}x${frame.height} iskey:${Number(frame.keyframe)}${stats}\n`);
      }
    } else if (name === "scale") {
      for (const key of Object.keys(named)) {
        if (!["w", "width", "h", "height", "s", "size", "flags", "force_original_aspect_ratio", "force_divisible_by"].includes(key)) {
          throw new Error(`scale: unsupported option ${key}`);
        }
      }
      if (positional.some((part, index) => index > 1 && !part.includes("="))) {
        throw new Error("scale: unsupported positional option");
      }
      if (named.flags !== undefined && !["neighbor", "lanczos", "bicubic", "bilinear", "area"].includes(named.flags)) {
        throw new Error("scale: unsupported flags");
      }
      const aspect = named.force_original_aspect_ratio ?? "disable";
      if (!["disable", "decrease", "increase", "0", "1", "2"].includes(aspect)) {
        throw new Error("scale: invalid force_original_aspect_ratio");
      }
      const divisor = Number(named.force_divisible_by ?? 1);
      if (!Number.isInteger(divisor) || divisor < 1 || divisor > 256) {
        throw new Error("scale: force_divisible_by must be an integer from 1 to 256");
      }
      const iw = current[0]!.width;
      const ih = current[0]!.height;
      const size = named.size ?? named.s;
      const width = named.w ?? named.width ?? (positional[0]?.includes("=") ? undefined : positional[0] || undefined);
      const height = named.h ?? named.height ?? (positional[1]?.includes("=") ? undefined : positional[1] || undefined);
      let wSpec = width ?? String(iw);
      let hSpec = height ?? String(ih);
      if (size !== undefined && (width !== undefined || height !== undefined)) {
        throw new Error("scale: size and width/height cannot be set together");
      }
      const parts = (size ?? (height === undefined ? width : undefined))?.toLowerCase().split("x");
      const validSize = parts?.length === 2 && parts.every(part => part.length > 0 && Array.from(part).every(char => char >= "0" && char <= "9") && Number.isSafeInteger(Number(part)) && Number(part) > 0);
      if (size !== undefined && !validSize) throw new Error("scale: invalid size");
      if (validSize) {
        wSpec = parts[0]!;
        hSpec = parts[1]!;
      }
      const variables = { iw, ih, in_w: iw, in_h: ih, ow: NaN, oh: NaN, out_w: NaN, out_h: NaN };
      variables.ow = variables.out_w = Math.trunc(parseFilterExpression(wSpec, "scale", variables));
      variables.oh = variables.out_h = Math.trunc(parseFilterExpression(hSpec, "scale", variables));
      // FFmpeg evaluates width again once height is available for output references.
      let targetW = Math.trunc(parseFilterExpression(wSpec, "scale", variables));
      let targetH = Math.trunc(variables.oh);
      if (!Number.isFinite(targetW) || !Number.isFinite(targetH)) {
        throw new Error("scale: dimensions must be finite");
      }
      if (targetW < 0 && targetH < 0) {
        targetW = iw;
        targetH = ih;
      }
      if (targetW === 0) targetW = iw;
      if (targetH === 0) targetH = ih;
      if (targetW < 0 && targetH > 0) {
        const multiple = -targetW;
        targetW = Math.max(1, Math.round((iw * targetH) / (Math.max(1, ih) * multiple))) * multiple;
      } else if (targetH < 0 && targetW > 0) {
        const multiple = -targetH;
        targetH = Math.max(1, Math.round((ih * targetW) / (Math.max(1, iw) * multiple))) * multiple;
      }
      if (aspect === "decrease" || aspect === "1" || aspect === "increase" || aspect === "2") {
        // Round the aspect-derived sizes to multiples before fitting the box.
        const fitWidth = Math.round(targetH * iw / (ih * divisor)) * divisor;
        const fitHeight = Math.round(targetW * ih / (iw * divisor)) * divisor;
        const bound = aspect === "decrease" || aspect === "1" ? Math.min : Math.max;
        targetW = bound(targetW, fitWidth);
        targetH = bound(targetH, fitHeight);
      }
      targetW = Math.max(1, targetW);
      targetH = Math.max(1, targetH);
      if (aspect !== "disable" && aspect !== "0") {
        const round = aspect === "decrease" || aspect === "1" ? Math.floor : Math.ceil;
        targetW = round(targetW / divisor) * divisor;
        targetH = round(targetH / divisor) * divisor;
        if (targetW <= 0 || targetH <= 0) throw new Error("scale: constrained dimensions must be positive");
      }

      current = await mapWork(current, async (f) => {


        budget.recordFrame(targetW, targetH);
        if (!named.flags || named.flags === "bicubic") {
          return {
            ...f,
            width: targetW,
            height: targetH,
            data: scaleVideoPicture(f, targetW, targetH) ?? await scaleFrame(f.data, f.width, f.height, targetW, targetH, signal)
          };
        }
        if (named.flags === "bilinear" || named.flags === "area" || named.flags === "lanczos") {
          return {
            ...f, width: targetW, height: targetH,
            data: await scaleFrame(f.data, f.width, f.height, targetW, targetH, signal, named.flags)
          };
        }
        const resized = resizeImage(makeRgbaImg(f.width, f.height, f.data), {
          width: targetW,
          height: targetH,
          fit: "fill",
          position: "center",
          kernel: "nearest",
          background: { r: 0, g: 0, b: 0, a: 255 },
          withoutEnlargement: false,
          withoutReduction: false
        });
        return {
          ...f,
          width: resized.width,
          height: resized.height,
          data: resized.data
        };
      }, signal);
    } else if (name === "super2xsai") {
      if (argStr) throw new Error("super2xsai: unsupported option");
      current = await mapWork(current, async (f) => {
        const width = f.width * 2;
        const height = f.height * 2;
        budget.recordFrame(width, height);
        const data = await super2xsaiFrame(f.data, f.width, f.height, signal);
        const { native: ignoredNative, ...frame } = f;
        return { ...frame, width, height, data };
      }, signal);
    } else if (name === "pixscope") {
      if (argStr) throw new Error("pixscope: options are not supported");
      current = await mapWork(current, f => pixscopeFrame(f, budget, signal), signal);
    } else if (name === "ciescope") {
      if (positional.some(part => part && !part.includes("=")) || Object.keys(named).some(key => key !== "size" && key !== "s")) {
        throw new Error("ciescope: options other than size (s) are not supported");
      }
      const size = Number(named.size ?? named.s ?? 512);
      if (!Number.isSafeInteger(size) || size < 256 || size > 8192) {
        throw new Error("ciescope: size must be an integer between 256 and 8192");
      }
      current = await mapWork(current, f => ciescopeFrame(f, size, budget, signal), signal);
    } else if (name === "datascope") {
      if (positional.length > 1 || Object.keys(named).some(key => key !== "size" && key !== "s")) {
        throw new Error("datascope: only size (s) is supported");
      }
      const size = named.size ?? named.s ?? (argStr || "1280x720");
      const dimensions = (size === "hd720" ? "1280x720" : size).split("x");
      const [width, height] = dimensions.map(Number);
      if (dimensions.length !== 2 || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
          width! <= 0 || height! <= 0) throw new Error("datascope: invalid output size");
      current = await mapWork(current, f => datascopeFrame(f, width!, height!, budget, signal), signal);
    } else if (name === "vectorscope") {
      if (argStr) throw new Error("vectorscope: options are not supported");
      current = await mapWork(current, async (f) => {
        const width = 256;
        const height = 256;
        budget.recordFrame(width, height);
        budget.allocateMemory(width * height * 4);
        const data = new Uint8Array(width * height * 4);
        for (let pixel = 0; pixel < width * height; pixel++) {
          if (pixel % 4096 === 0) { await yieldTurn(signal); budget.checkCpu(); }
          data[pixel * 4 + 3] = 255;
        }
        // Default RGB vectorscope: blue on x, inverted red on y, intensity 1/255.
        for (let pixel = 0; pixel < f.width * f.height; pixel++) {
          if (pixel % 4096 === 0) { await yieldTurn(signal); budget.checkCpu(); }
          const offset = ((255 - f.data[pixel * 4]!) * width + f.data[pixel * 4 + 2]!) * 4;
          const intensity = Math.min(255, data[offset]! + 1);
          data[offset] = data[offset + 1] = data[offset + 2] = intensity;
        }
        const { native: ignoredNative, ...frame } = f;
        return { ...frame, width, height, data };
      }, signal);
    } else if (name === "oscilloscope") {
      if (argStr) throw new Error("oscilloscope: options are not supported");
      let frameIndex = 0;
      current = await mapWork(current, f => oscilloscope(f, frameIndex++, budget, signal), signal);
    } else if (name === "waveform") {
      if (argStr) throw new Error("waveform: options are not supported");
      current = await mapWork(current, async (f) => {
        const height = 256;
        budget.recordFrame(f.width, height);
        budget.allocateMemory(f.width * height * 4);
        const data = new Uint8Array(f.width * height * 4);
        for (let pixel = 0; pixel < f.width * height; pixel++) {
          if (pixel % 4096 === 0) { await yieldTurn(signal); budget.checkCpu(); }
          data[pixel * 4 + 3] = 255;
        }
        // Default RGB waveform: mirrored red component, column mode, intensity 0.04.
        for (let pixel = 0; pixel < f.width * f.height; pixel++) {
          if (pixel % 4096 === 0) { await yieldTurn(signal); budget.checkCpu(); }
          const row = 255 - f.data[pixel * 4]!;
          const offset = (row * f.width + pixel % f.width) * 4;
          data[offset] = Math.min(255, data[offset]! + 10);
        }
        const { native: ignoredNative, ...frame } = f;
        return { ...frame, height, data };
      }, signal);
    } else if (name === "xbr") {
      if (positional.length > 1 || Object.keys(named).some(key => key !== "n")) {
        throw new Error("xbr: unsupported option");
      }
      const factor = argStr ? parseFilterExpression(named.n ?? argStr, "xbr", {}) : 3;
      if (factor !== 2 && factor !== 3 && factor !== 4) throw new Error("xbr: n must be 2, 3 or 4");
      current = await mapWork(current, async (f) => {
        const width = f.width * factor;
        const height = f.height * factor;
        budget.recordFrame(width, height);
        const data = await xbrFrame(f.data, f.width, f.height, factor, signal);
        const { native: ignoredNative, ...frame } = f;
        return { ...frame, width, height, data };
      }, signal);
    } else if (name === "hqx") {
      if (positional.length > 1 || Object.keys(named).some(key => key !== "n")) {
        throw new Error("hqx: unsupported option");
      }
      const factor = argStr ? parseFilterExpression(named.n ?? argStr, "hqx", {}) : 3;
      if (factor !== 2 && factor !== 3 && factor !== 4) throw new Error("hqx: n must be 2, 3 or 4");
      current = await mapWork(current, async (f) => {
        const width = f.width * factor;
        const height = f.height * factor;
        budget.recordFrame(width, height);
        const data = await hqxFrame(f.data, f.width, f.height, factor, signal);
        const { native: ignoredNative, ...frame } = f;
        return { ...frame, width, height, data };
      }, signal);
    } else if (name === "epx") {
      if (positional.length > 1 || Object.keys(named).some(key => key !== "n")) {
        throw new Error("epx: unsupported option");
      }
      const factor = argStr ? parseFilterExpression(named.n ?? argStr, "epx", {}) : 3;
      if (factor !== 2 && factor !== 3) throw new Error("epx: n must be 2 or 3");
      current = await mapWork(current, async (f) => {
        const width = f.width * factor;
        const height = f.height * factor;
        budget.recordFrame(width, height);
        const data = await epxFrame(f.data, f.width, f.height, factor, signal);
        const { native: ignoredNative, ...frame } = f;
        return { ...frame, width, height, data };
      }, signal);
    } else if (name === "stereo3d") {
      const options: Record<string, string> = { in: "sbsl" };
      let namedOption = false;
      for (const [index, part] of (argStr ? positional : []).entries()) {
        const separator = part.indexOf("=");
        const key = separator < 0 ? ["in", "out"][index] : part.slice(0, separator).trim();
        if (!key || !["in", "out"].includes(key) || (separator < 0 && namedOption)) {
          throw new Error(`stereo3d: unknown or misplaced option ${part}`);
        }
        namedOption ||= separator >= 0;
        options[key] = (separator < 0 ? part : part.slice(separator + 1)).trim();
      }
      if (options.in !== "sbsl" || !["ml", "mr"].includes(options.out ?? "")) {
        throw new Error("stereo3d: supported conversion is sbsl to ml or mr");
      }
      current = await mapWork(current, f => {
        if (f.width % 2 !== 0) throw new Error("stereo3d: side-by-side input width must be even");
        const width = f.width / 2;
        budget.recordFrame(width, f.height);
        budget.allocateMemory(width * f.height * 4);
        const cropped = extractImage(makeRgbaImg(f.width, f.height, f.data), {
          left: options.out === "ml" ? 0 : width, top: 0, width, height: f.height
        });
        const { native: ignoredNative, ...frame } = f;
        return { ...frame, width, data: cropped.data };
      }, signal);
    } else if (name === "crop") {
      const crop: Record<string, string> = {};
      const keys = ["w", "h", "x", "y", "keep_aspect", "exact"];
      let namedOption = false;
      for (const [index, part] of (argStr ? positional : []).entries()) {
        const separator = part.indexOf("=");
        let key = separator < 0 ? keys[index] : part.slice(0, separator).trim();
        if (key === "out_w") key = "w";
        if (key === "out_h") key = "h";
        if (!key || !keys.includes(key) || (separator < 0 && namedOption)) {
          throw new Error(`crop: unknown or misplaced option ${part}`);
        }
        namedOption ||= separator >= 0;
        const value = (separator < 0 ? part : part.slice(separator + 1)).trim();
        if (key === "keep_aspect" || key === "exact") {
          if (!["0", "1", "true", "false", "yes", "no", "on", "off"].includes(value.toLowerCase())) {
            throw new Error(`crop: ${key} must be a boolean`);
          }
        }
        crop[key] = value;
      }
      const iw = current[0]!.width;
      const ih = current[0]!.height;
      // Preserve the decoded chroma grid even after earlier RGBA filter operations.
      // AVPixelFormat: YUV420P/YUVJ420P and YUV422P/YUVJ422P.
      const format = current[0]!.native?.format;
      const exact = ["1", "true", "yes", "on"].includes((crop.exact ?? "0").toLowerCase());
      const inputHsub = format === 0 || format === 12 || format === 4 || format === 13 ? 2 : 1;
      const inputVsub = format === 0 || format === 12 ? 2 : 1;
      const hsub = exact ? 1 : inputHsub;
      const vsub = exact ? 1 : inputVsub;
      const dimensions = {
        iw, ih, in_w: iw, in_h: ih, ow: NaN, oh: NaN, out_w: NaN, out_h: NaN,
        a: iw / ih, sar: diagnostics.sar, dar: iw / ih * diagnostics.sar,
        hsub: inputHsub, vsub: inputVsub
      };
      // Resolve width again after height so either dimension can depend on the other.
      dimensions.ow = dimensions.out_w = parseFilterExpression(crop.w ?? String(iw), "crop", dimensions);
      dimensions.oh = dimensions.out_h = parseFilterExpression(crop.h ?? String(ih), "crop", dimensions);
      dimensions.ow = dimensions.out_w = parseFilterExpression(crop.w ?? String(iw), "crop", dimensions);
      const cw = Math.floor(roundToEven(dimensions.ow) / hsub) * hsub;
      const ch = Math.floor(roundToEven(dimensions.oh) / vsub) * vsub;
      if (!Number.isFinite(cw) || !Number.isFinite(ch) || cw <= 0 || ch <= 0 || cw > iw || ch > ih) {
        throw new Error(`Invalid too big or non positive size for width '${cw}' or height '${ch}'`);
      }
      if (["1", "true", "yes", "on"].includes((crop.keep_aspect ?? "0").toLowerCase())) {
        let numerator = diagnostics.sarWidth * iw * ch;
        let denominator = diagnostics.sarHeight * ih * cw;
        while (denominator !== 0) {
          const remainder = numerator % denominator;
          numerator = denominator;
          denominator = remainder;
        }
        diagnostics.sarWidth = diagnostics.sarWidth * iw * ch / numerator;
        diagnostics.sarHeight = diagnostics.sarHeight * ih * cw / numerator;
        diagnostics.sar = diagnostics.sarWidth / diagnostics.sarHeight;
      }
      const variables = { ...dimensions, ow: cw, oh: ch, out_w: cw, out_h: ch, n: 0, t: 0, x: NaN, y: NaN };
      const xExpression = crop.x ?? String((iw - cw) / 2);
      const yExpression = crop.y ?? String((ih - ch) / 2);
      current = await mapWork(current, async (f, n) => {
        variables.n = n;
        variables.t = f.ptsSeconds;
        // FFmpeg evaluates x again after y so either coordinate can depend on the other.
        variables.x = parseFilterExpression(xExpression, "crop", variables);
        variables.y = parseFilterExpression(yExpression, "crop", variables);
        variables.x = parseFilterExpression(xExpression, "crop", variables);
        if (!Number.isFinite(variables.x) || !Number.isFinite(variables.y)) {
          throw new Error("crop: invalid or unsupported expression");
        }
        const cx = Math.max(0, Math.min(iw - cw, roundToEven(variables.x)));
        const cy = Math.max(0, Math.min(ih - ch, roundToEven(variables.y)));
        const left = Math.floor(cx / hsub) * hsub;
        const top = Math.floor(cy / vsub) * vsub;
        const source = f.native;
        if (source && source.rgba === f.data && source.width === f.width && source.height === f.height &&
            [0, 4, 5, 12, 13, 14].includes(source.format)) {
          const chromaWidth = Math.ceil(cw / inputHsub);
          const chromaHeight = Math.ceil(ch / inputVsub);
          const pixels = new Uint8Array(cw * ch + 2 * chromaWidth * chromaHeight);
          let offset = 0;
          let outputOffset = 0;
          for (let plane = 0; plane < 3; plane++) {
            const sx = plane === 0 ? 1 : inputHsub;
            const sy = plane === 0 ? 1 : inputVsub;
            const width = Math.ceil(f.width / sx);
            const height = Math.ceil(f.height / sy);
            const outputWidth = plane === 0 ? cw : chromaWidth;
            const outputHeight = plane === 0 ? ch : chromaHeight;
            // Even exact crops address chroma at the containing subsampled pixel.
            const x = Math.floor(left / sx);
            const y = Math.floor(top / sy);
            for (let row = 0; row < outputHeight; row++) {
              await yieldTurn(signal);
              signal?.throwIfAborted();
              budget.checkCpu();
              const start = offset + (y + row) * width + x;
              pixels.set(source.pixels.subarray(start, start + outputWidth), outputOffset + row * outputWidth);
            }
            offset += width * height;
            outputOffset += outputWidth * outputHeight;
          }
          const native = { ...source, width: cw, height: ch, pixels };
          const data = scaleVideoPicture({ ...f, width: cw, height: ch, native }, cw, ch)!;
          return { ...f, width: cw, height: ch, data, native: { ...native, rgba: data } };
        }
        const cropped = extractImage(makeRgbaImg(f.width, f.height, f.data), {
          left,
          top,
          width: cw,
          height: ch
        });
        return {
          ...f,
          width: cropped.width,
          height: cropped.height,
          data: cropped.data
        };
      }, signal);
    } else if (name === "pad") {
      for (const key of Object.keys(named)) {
        if (!["w", "width", "h", "height", "x", "y", "color", "eval", "aspect"].includes(key)) {
          throw new Error(`pad: unsupported option ${key}`);
        }
      }
      if (positional.some((part, index) => index > 6 && !part.includes("="))) {
        throw new Error("pad: too many positional options");
      }
      const evaluation = named.eval ?? (positional[5]?.includes("=") ? undefined : positional[5]) ?? "init";
      if (!["init", "frame", "0", "1"].includes(evaluation)) {
        throw new Error("pad: eval must be init or frame");
      }
      const aspectExpression = named.aspect ?? (positional[6]?.includes("=") ? undefined : positional[6]) ?? "0";
      const aspect = parseFilterExpression(aspectExpression, "pad", {});
      if (!Number.isFinite(aspect) || aspect < 0) {
        throw new Error("pad: aspect must be a finite nonnegative ratio");
      }
      const iw = current[0]!.width;
      const ih = current[0]!.height;
      const width = named.w ?? named.width ?? (positional[0]?.includes("=") ? undefined : positional[0]) ?? String(iw);
      const height = named.h ?? named.height ?? (positional[1]?.includes("=") ? undefined : positional[1]) ?? String(ih);
      const format = current[0]!.native?.format;
      const hsub = format === 0 || format === 12 || format === 4 || format === 13 ? 2 : 1;
      const vsub = format === 0 || format === 12 ? 2 : 1;
      const dimensions = {
        iw, ih, in_w: iw, in_h: ih, ow: NaN, oh: NaN, out_w: NaN, out_h: NaN,
        a: iw / ih, sar: diagnostics.sar, dar: iw / ih * diagnostics.sar, hsub, vsub
      };
      // Resolve width again after height so either dimension can depend on the other.
      dimensions.ow = dimensions.out_w = Math.trunc(parseFilterExpression(width, "pad", dimensions));
      dimensions.oh = dimensions.out_h = Math.trunc(parseFilterExpression(height, "pad", dimensions));
      if (dimensions.oh === 0) dimensions.oh = dimensions.out_h = ih;
      let pw = Math.trunc(parseFilterExpression(width, "pad", dimensions));
      let ph = dimensions.oh;
      if (!Number.isFinite(pw) || !Number.isFinite(ph)) {
        throw new Error("pad: invalid or unsupported expression");
      }
      pw ||= iw;
      if (aspect > 0) {
        const pixelAspect = aspect / diagnostics.sar;
        const aspectHeight = Math.round(pw / pixelAspect);
        if (ph < aspectHeight) ph = aspectHeight;
        else pw = Math.round(ph * pixelAspect);
      }
      pw = Math.floor(pw / hsub) * hsub;
      ph = Math.floor(ph / vsub) * vsub;
      if (pw < iw || ph < ih) {
        throw new Error("Padded dimensions cannot be smaller than input dimensions");
      }
      const variables = { ...dimensions, ow: pw, oh: ph, out_w: pw, out_h: ph, x: NaN, y: NaN };
      const xExpression = named.x ?? (positional[2]?.includes("=") ? undefined : positional[2]) ?? "0";
      const yExpression = named.y ?? (positional[3]?.includes("=") ? undefined : positional[3]) ?? "0";
      // FFmpeg evaluates x again after y so either coordinate can depend on the other.
      variables.x = parseFilterExpression(xExpression, "pad", variables);
      variables.y = parseFilterExpression(yExpression, "pad", variables);
      variables.x = parseFilterExpression(xExpression, "pad", variables);
      if (!Number.isFinite(variables.x) || !Number.isFinite(variables.y)) {
        throw new Error("pad: invalid or unsupported expression");
      }
      const x = Math.trunc(variables.x);
      const y = Math.trunc(variables.y);
      // Align placement to the source chroma grid, as with crop.
      const px = Math.floor((x < 0 || x > pw - iw ? Math.trunc((pw - iw) / 2) : x) / hsub) * hsub;
      const py = Math.floor((y < 0 || y > ph - ih ? Math.trunc((ph - ih) / 2) : y) / vsub) * vsub;
      const col = parseColorRgba(named.color ?? (positional[4]?.includes("=") ? undefined : positional[4]) ?? "black");
      if (pixelFormat === "gray" || pixelFormat === "gray8" || pixelFormat === "gray16be" || pixelFormat === "ya8") {
        // Pad uses full-range BT.601 luma for grayscale frames.
        const gray = Math.round(0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2]);
        col[0] = col[1] = col[2] = gray;
        if (pixelFormat !== "ya8") col[3] = 255;
      }
      current = await mapWork(current, async (f) => {


        const padded = extendImage(makeRgbaImg(f.width, f.height, f.data), {
          left: px,
          top: py,
          right: Math.max(0, pw - iw - px),
          bottom: Math.max(0, ph - ih - py),
          background: { r: col[0], g: col[1], b: col[2], a: col[3] },
          extendWith: "background"
        });
        return {
          ...f,
          width: padded.width,
          height: padded.height,
          data: padded.data
        };
      }, signal);
    } else if (name === "hflip" || name === "vflip") {
      if (argStr && positional.some(part => part.slice(0, part.indexOf("=")).trim() !== "enable" || !part.includes("="))) {
        throw new Error(`${name}: unsupported option`);
      }
      if (named.enable !== undefined && current.length === 0) {
        parseFilterExpression(named.enable, `${name} enable`, { n: 0, t: 0, w: 0, h: 0 });
      }
      current = await mapWork(current, async (f, n) => {
        if (named.enable !== undefined && Math.abs(parseFilterExpression(named.enable, `${name} enable`, {
          n, t: f.ptsSeconds, w: f.width, h: f.height
        })) < 0.5) return f;
        const image = makeRgbaImg(f.width, f.height, f.data);
        const out = name === "hflip" ? flopImage(image) : flipImage(image);
        const native = f.native;
        if (native?.rgba === f.data && native.width === f.width && native.height === f.height &&
            [0, 4, 5, 12, 13, 14].includes(native.format)) {
          const pixels = new Uint8Array(native.pixels);
          const chromaWidth = Math.ceil(f.width / ([5, 14].includes(native.format) ? 1 : 2));
          const chromaHeight = Math.ceil(f.height / ([0, 12].includes(native.format) ? 2 : 1));
          let offset = 0;
          for (const [width, height] of [[f.width, f.height], [chromaWidth, chromaHeight], [chromaWidth, chromaHeight]] as const) {
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
              pixels[offset + y * width + x] = native.pixels[offset +
                (name === "vflip" ? height - 1 - y : y) * width + (name === "hflip" ? width - 1 - x : x)]!;
            }
            offset += width * height;
          }
          return { ...f, data: out.data, native: { ...native, rgba: out.data, pixels } };
        }
        return { ...f, data: out.data };
      }, signal);
    } else if (name === "transpose") {
      let direction = "0";
      let passthrough = "none";
      for (const [index, part] of (argStr ? positional : []).entries()) {
        const separator = part.indexOf("=");
        const key = separator < 0 ? ["dir", "passthrough"][index] : part.slice(0, separator).trim();
        const value = (separator < 0 ? part : part.slice(separator + 1)).trim();
        if (key === "dir") direction = value;
        else if (key === "passthrough") passthrough = value;
        else throw new Error(`transpose: unsupported option ${key}`);
      }
      const directions: Record<string, number> = { cclock_flip: 0, clock: 1, cclock: 2, clock_flip: 3 };
      let dir = parseFilterExpression(direction, "transpose", directions);
      if (!Number.isInteger(dir) || dir < 0 || dir > 7) throw new Error("transpose: invalid direction");
      const modes: Record<string, number> = { none: 0, landscape: 1, portrait: 2 };
      let pass = Object.hasOwn(modes, passthrough) ? modes[passthrough]! : passthrough ? Number(passthrough) : NaN;
      if (!Number.isInteger(pass) || pass < 0 || pass > 2147483647) throw new Error("transpose: invalid passthrough");
      if (dir >= 4) { dir -= 4; pass = 1; }
      const angle = dir === 0 || dir === 2 ? 270 : 90;
      current = await mapWork(current, async (f) => {
        if ((pass === 1 && f.width >= f.height) || (pass === 2 && f.width <= f.height)) return f;
        const source = f.native;
        // Transpose preserves planar formats with equal horizontal/vertical subsampling.
        if (source && source.rgba === f.data && source.width === f.width && source.height === f.height &&
            [0, 5, 12, 14].includes(source.format)) {
          budget.allocateMemory(source.pixels.length + f.data.byteLength);
          const pixels = new Uint8Array(source.pixels.length);
          const subsampling = source.format === 0 || source.format === 12 ? 2 : 1;
          let offset = 0;
          for (let plane = 0; plane < 3; plane++) {
            const width = Math.ceil(f.width / (plane === 0 ? 1 : subsampling));
            const height = Math.ceil(f.height / (plane === 0 ? 1 : subsampling));
            for (let y = 0; y < height; y++) {
              if (y % 32 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
              for (let x = 0; x < width; x++) {
                const outputX = dir === 1 || dir === 3 ? height - 1 - y : y;
                const outputY = dir === 2 || dir === 3 ? width - 1 - x : x;
                pixels[offset + outputY * height + outputX] = source.pixels[offset + y * width + x]!;
              }
            }
            offset += width * height;
          }
          const native = { ...source, width: f.height, height: f.width, pixels };
          const data = scaleVideoPicture({ ...f, width: f.height, height: f.width, native }, f.height, f.width)!;
          return { ...f, width: f.height, height: f.width, data, native: { ...native, rgba: data } };
        }
        const rotated = rotateImage(makeRgbaImg(f.width, f.height, f.data), angle);
        const out = dir === 0 || dir === 3 ? flipImage(rotated) : rotated;
        return {
          ...f,
          width: out.width,
          height: out.height,
          data: out.data
        };
      }, signal);
    } else if (name === "rotate") {
      const rotatePositional = positional.filter(option => !option.includes("="));
      if (rotatePositional.length > 3 || Object.keys(named).some(key => !["angle", "a", "ow", "out_w", "oh", "out_h", "c", "fillcolor", "bilinear", "enable"].includes(key))) {
        throw new Error("rotate: unsupported option");
      }
      const interpolation = (named.bilinear ?? "1").toLowerCase();
      if (!["0", "1", "true", "false", "yes", "no", "on", "off", "enabled", "disabled"].includes(interpolation)) {
        throw new Error("rotate: bilinear must be a boolean");
      }
      const bilinear = !["0", "false", "no", "off", "disabled"].includes(interpolation);
      let fill: [number, number, number, number];
      try {
        fill = parseColorRgba(named.fillcolor ?? named.c ?? "black");
      } catch (error) {
        throw new Error(`rotate: ${(error as Error).message}`);
      }
      const angleExpression = named.angle ?? named.a ?? (rotatePositional[0] || "0");
      if (current.length === 0) parseFilterExpression(angleExpression, "rotate", { PI: Math.PI, n: 0, t: 0 });
      current = await mapWork(current, async (f, n) => {
        if (named.enable !== undefined && Math.abs(parseFilterExpression(named.enable, "rotate enable", {
          n, t: f.ptsSeconds, w: f.width, h: f.height
        })) < 0.5) return f;
        const angle = parseFilterExpression(angleExpression, "rotate", {
          PI: Math.PI, n, t: f.ptsSeconds, iw: f.width, in_w: f.width, ih: f.height, in_h: f.height
        });
        const fixedAngle = Math.trunc(angle * 1048576);
        const sin = fixedSin(fixedAngle);
        const cos = fixedSin(fixedAngle + Math.trunc(3294199 / 2));
        const dimensions = { PI: Math.PI, iw: f.width, ih: f.height, in_w: f.width, in_h: f.height,
          ow: f.width, oh: f.height, out_w: f.width, out_h: f.height };
        const widthExpression = named.ow ?? named.out_w ?? (rotatePositional[1] || "iw");
        const heightExpression = named.oh ?? named.out_h ?? (rotatePositional[2] || "ih");
        dimensions.ow = dimensions.out_w = parseFilterExpression(widthExpression, "rotate", dimensions);
        dimensions.oh = dimensions.out_h = parseFilterExpression(heightExpression, "rotate", dimensions);
        const width = Math.trunc(parseFilterExpression(widthExpression, "rotate", dimensions));
        const height = Math.trunc(dimensions.oh);
        if (width <= 0 || height <= 0) throw new Error("rotate: output dimensions must be positive");
        budget.recordFrame(width, height);
        const yuv = fill[0] === 0 && fill[1] === 0 && fill[2] === 0 && fill[3] === 255
          ? await rotateYuvFrame(f, angle, width, height, bilinear, budget, signal) : undefined;
        if (yuv) return yuv;
        const data = new Uint8Array(width * height * 4);
        const xi = Math.trunc(-(width - 1) * cos / 2);
        const yi = Math.trunc((width - 1) * sin / 2);
        const xprime = Math.trunc(-(height - 1) * sin / 2);
        const yprime = Math.trunc(-(height - 1) * cos / 2);
        for (let y = 0; y < height; y++) {
          await yieldTurn(signal);
          budget.checkCpu();
          for (let x = 0; x < width; x++) {
            const sx = (xprime + y * sin + xi + 65536 * (f.width - 1) / 2 + x * cos) / 65536;
            const sy = (yprime + y * cos + yi + 65536 * (f.height - 1) / 2 - x * sin) / 65536;
            const dest = (y * width + x) * 4;
            data.set(fill, dest);
            const ix = Math.floor(sx);
            const iy = Math.floor(sy);
            if (ix < -1 || ix > f.width || iy < -1 || iy > f.height) continue;
            // FFmpeg clips the integer index but retains the original fractional
            // weight, including in the one-pixel interpolation border.
            const x0 = Math.max(0, Math.min(f.width - 1, ix));
            const y0 = Math.max(0, Math.min(f.height - 1, iy));
            if (!bilinear) {
              const source = (y0 * f.width + x0) * 4;
              data.set(f.data.subarray(source, source + 4), dest);
              continue;
            }
            const x1 = Math.min(x0 + 1, f.width - 1);
            const y1 = Math.min(y0 + 1, f.height - 1);
            const dx = sx - ix;
            const dy = sy - iy;
            for (let c = 0; c < 4; c++) {
              const top = f.data[(y0 * f.width + x0) * 4 + c]! * (1 - dx) + f.data[(y0 * f.width + x1) * 4 + c]! * dx;
              const bottom = f.data[(y1 * f.width + x0) * 4 + c]! * (1 - dx) + f.data[(y1 * f.width + x1) * 4 + c]! * dx;
              data[dest + c] = Math.floor(top * (1 - dy) + bottom * dy);
            }
          }
        }
        return { ...f, width, height, data };
      }, signal);
    } else if (name === "histogram") {
      if (argStr) throw new Error("histogram: options are not supported");
      current = await mapWork(current, async (f) => {
        const width = 256;
        const levelHeight = 200;
        const scaleHeight = 12;
        const height = (levelHeight + scaleHeight) * 3;
        budget.recordFrame(width, height);
        const data = new Uint8Array(width * height * 4);
        for (let channel = 0; channel < 3; channel++) {
          const bins = new Uint32Array(256);
          for (let i = channel; i < f.data.length; i += 4) {
            if ((i - channel) % 65536 === 0) {
              await yieldTurn(signal);
              signal?.throwIfAborted();
              budget.checkCpu();
            }
            bins[f.data[i]!]!++;
          }
          const maximum = Math.max(...bins);
          const top = channel * (levelHeight + scaleHeight);
          for (let y = 0; y < levelHeight + scaleHeight; y++) {
            if (y % 32 === 0) {
              await yieldTurn(signal);
              signal?.throwIfAborted();
              budget.checkCpu();
            }
            for (let x = 0; x < width; x++) {
              const offset = ((top + y) * width + x) * 4;
              if (y >= levelHeight) {
                data[offset + channel] = x;
              } else if (y >= levelHeight - Math.ceil(bins[x]! * levelHeight / maximum)) {
                data[offset] = data[offset + 1] = data[offset + 2] = 255;
              }
              data[offset + 3] = 255;
            }
          }
        }
        // The histogram is a new RGB raster; source native planes no longer apply.
        return { width, height, data, ptsSeconds: f.ptsSeconds,
          durationSeconds: f.durationSeconds, keyframe: true };
      }, signal);
    } else if (name === "negate") {
      if (positional.filter(value => !value.includes("=")).length > 2 || Object.keys(named).some(key => key !== "components" && key !== "negate_alpha" && key !== "enable")) {
        throw new Error("negate: unknown option");
      }
      const components = named.components ?? (positional[0]?.includes("=") ? undefined : positional[0] || undefined);
      const negateAlpha = parseFilterBoolean(
        named.negate_alpha ?? (positional[1]?.includes("=") ? undefined : positional[1]) ?? "0",
        "negate: invalid negate_alpha boolean"
      );
      const flags = components ?? "0";
      const relative = flags.startsWith("+") || flags.startsWith("-");
      let mask = relative ? 0b0111111 : 0;
      let position = 0;
      do {
        const remove = flags[position] === "-";
        if (remove || flags[position] === "+") position++;
        const start = position;
        while (position < flags.length && flags[position] !== "+" && flags[position] !== "-") position++;
        const component = flags.slice(start, position);
        if (component === "none") continue;
        if (!component.trim()) throw new Error("negate: invalid empty component");
        const index = ["r", "g", "b", "y", "u", "v", "a"].indexOf(component);
        const value = index < 0 ? Number(component) : 1 << index;
        if (!Number.isInteger(value) || value < 0 || value > 127) {
          throw new Error(`negate: invalid component ${component}`);
        }
        mask = remove ? mask & ~value : mask | value;
      } while (position < flags.length);
      current = await mapWork(current, async (f, n) => {
        const source = f.native;
        const planar = source && source.rgba === f.data && source.width === f.width && source.height === f.height &&
          [0, 4, 5, 12, 13, 14].includes(source.format) ? source : undefined;
        const gray = pixelFormat === "gray" || pixelFormat === "gray8" || pixelFormat === "gray16be" || pixelFormat === "ya8";
        const available = planar ? 0b0111000 : gray ? (pixelFormat === "ya8" ? 0b1001000 : 0b0001000) :
          pixelFormat === "rgb24" || pixelFormat === "bgr24" ? 0b0000111 : 0b1000111;
        // An unchanged all-color default selects only the negotiated format's components.
        // RGBA alpha is selected by components; grayscale alpha also honors negate_alpha.
        const selected = (components === undefined || relative && mask === 0b0111111 ? available & 0b0111111 : mask) |
          (pixelFormat === "ya8" && negateAlpha ? 0b1000000 : 0);
        if (selected & ~available) throw new Error("negate: Requested components not available");
        if (named.enable !== undefined && !(Math.abs(parseFilterExpression(named.enable, "negate enable", {
          n, t: f.ptsSeconds, w: f.width, h: f.height, pos: f.offset ?? NaN, NAN: NaN, INF: Infinity
        })) >= 0.5)) return f;
        // Negate planar 8-bit YUV before RGB conversion, including full-range YUV.
        if (planar) {
          const lumaSize = f.width * f.height;
          const chromaSize = Math.ceil(f.width / ([5, 14].includes(planar.format) ? 1 : 2)) *
            Math.ceil(f.height / ([0, 12].includes(planar.format) ? 2 : 1));
          const pixels = new Uint8Array(planar.pixels);
          for (let plane = 0; plane < 3; plane++) {
            if (!(selected & (1 << (3 + plane)))) continue;
            const start = plane === 0 ? 0 : lumaSize + (plane - 1) * chromaSize;
            const end = start + (plane === 0 ? lumaSize : chromaSize);
            for (let i = start; i < end; i++) {
              if (i % 65536 === 0) {
                await yieldTurn(signal);
                signal?.throwIfAborted();
                budget.checkCpu();
              }
              pixels[i] = 255 - pixels[i]!;
            }
          }
          const native = { ...planar, pixels };
          const data = scaleVideoPicture({ ...f, native }, f.width, f.height)!;
          return { ...f, data, native: { ...native, rgba: data } };
        }
        const data = f.data.slice();
        for (let i = 0; i < data.length; i++) {
          if (i % 65536 === 0) {
            await yieldTurn(signal);
            signal?.throwIfAborted();
            budget.checkCpu();
          }
          const component = i % 4 === 3 ? 6 : gray ? 3 : i % 4;
          if (selected & (1 << component)) data[i] = 255 - data[i]!;
        }
        return { ...f, data };
      }, signal);
    } else if (name === "format") {
      let formats: string[] | undefined;
      for (const [index, part] of (argStr ? positional : []).entries()) {
        const separator = part.indexOf("=");
        const key = separator < 0 ? (index === 0 ? "pix_fmts" : undefined) : part.slice(0, separator).trim();
        if (key !== "pix_fmts") throw new Error(`format: unsupported option ${part}`);
        const values = (separator < 0 ? part : part.slice(separator + 1)).trim().split("|");
        for (const value of values) {
          if (!["monob", "pal8", "rgba", "bgra", "rgb24", "bgr24", "gray", "gray8", "ya8", "rgba64be", "rgb48be", "gray16be", "yuv420p", "yuv422p", "yuv444p"].includes(value)) {
            throw new Error(`format: unsupported pixel format ${value}`);
          }
        }
        formats = values;
      }
      if (formats) {
        const previousPixelFormat = pixelFormat;
        pixelFormat = formats.includes(pixelFormat ?? "rgba") ? pixelFormat ?? "rgba" : formats[0]!;
        diagnostics.pixelFormat = pixelFormat;
        if (pixelFormat === "yuv420p" || pixelFormat === "yuv422p" || pixelFormat === "yuv444p") {
          const target = pixelFormat;
          current = await mapWork(current, async frame => {
            budget.checkCpu();
            const converted = await formatYuv(frame, target, signal);
            budget.checkCpu();
            return converted;
          }, signal);
        } else if (!["gray", "gray8", "ya8", "gray16be"].includes(pixelFormat)) {
          current = current.map(({ native: _native, ...frame }) => frame);
        }
        if (pixelFormat === "monob" && previousPixelFormat !== "monob") {
          // swscale's ordered 8x8 dither applied to limited-range BT.601 luma.
          const dither = [
            [117, 62, 158, 103, 113, 58, 155, 100],
            [34, 199, 21, 186, 31, 196, 17, 182],
            [144, 89, 131, 76, 141, 86, 127, 72],
            [0, 165, 41, 206, 10, 175, 52, 217],
            [110, 55, 151, 96, 120, 65, 162, 107],
            [28, 193, 14, 179, 38, 203, 24, 189],
            [138, 83, 124, 69, 148, 93, 134, 79],
            [7, 172, 48, 213, 3, 168, 45, 210]
          ];
          current = await mapWork(current, async f => {
            const data = f.data.slice();
            for (let i = 0; i < data.length; i += 4) {
              if (i % 65536 === 0) {
                await yieldTurn(signal);
                signal?.throwIfAborted();
                budget.checkCpu();
              }
              const luma = Math.round(16 + (0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!) * 219 / 255);
              const pixel = i / 4;
              const value = luma + dither[Math.floor(pixel / f.width) & 7]![pixel % f.width & 7]! >= 234 ? 255 : 0;
              data[i] = data[i + 1] = data[i + 2] = value;
              data[i + 3] = 255;
            }
            return { ...f, data };
          }, signal);
        }
        if (pixelFormat === "pal8" && previousPixelFormat !== "pal8") {
          current = await mapWork(current, async (f) => {
            const data = f.data.slice();
            // swscale's default error diffusion carries three channel errors across rows.
            const errors = Array.from({ length: 3 }, () => new Int32Array(f.width + 2));
            for (let y = 0; y < f.height; y++) {
              const previous = [0, 0, 0];
              for (let x = 0; x < f.width; x++) {
                const offset = (y * f.width + x) * 4;
                if (offset % 65536 === 0) {
                  await yieldTurn(signal);
                  signal?.throwIfAborted();
                  budget.checkCpu();
                }
                for (let channel = 0; channel < 3; channel++) {
                  const row = errors[channel]!;
                  const value = data[offset + channel]! +
                    ((7 * previous[channel]! + row[x]! + 5 * row[x + 1]! + 3 * row[x + 2]!) >> 4);
                  row[x] = previous[channel]!;
                  const level = Math.max(0, Math.min(channel === 2 ? 3 : 7, value >> (channel === 2 ? 6 : 5)));
                  const quantized = level * (channel === 2 ? 85 : 36);
                  previous[channel] = value - quantized;
                  data[offset + channel] = quantized;
                }
                data[offset + 3] = 255;
              }
              for (let channel = 0; channel < 3; channel++) errors[channel]![f.width] = previous[channel]!;
            }
            return { ...f, data };
          }, signal);
        }
        if (pixelFormat === "rgb24" || pixelFormat === "bgr24" || pixelFormat === "rgb48be") {
          current = await mapWork(current, async (f) => {
            const data = f.data.slice();
            for (let i = 3; i < data.length; i += 4) {
              if (i % 65536 === 3) {
                await yieldTurn(signal);
                signal?.throwIfAborted();
                budget.checkCpu();
              }
              data[i] = 255;
            }
            return { ...f, data };
          }, signal);
        }
        if (pixelFormat === "gray" || pixelFormat === "gray8" || pixelFormat === "ya8" || pixelFormat === "gray16be") {
          current = await mapWork(current, async ({ native, ...f }) => {
            const planar = native?.rgba === f.data && native.width === f.width && native.height === f.height &&
              [0, 4, 5, 12, 13, 14].includes(native.format) ? native : undefined;
            const data = f.data.slice();
            for (let i = 0; i < data.length; i += 4) {
              if (i % 65536 === 0) {
                await yieldTurn(signal);
                signal?.throwIfAborted();
                budget.checkCpu();
              }
              // Expand planar luma directly: RGB conversion can clip colored pixels.
              // RGB sources use full-range BT.601 luminance.
              const gray = planar
                ? planar.fullRange || [12, 13, 14].includes(planar.format) ? planar.pixels[i / 4]!
                  : Math.max(0, Math.min(255, Math.round((planar.pixels[i / 4]! - 16) * 255 / 219)))
                : Math.round(0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!);
              data[i] = data[i + 1] = data[i + 2] = gray;
              if (pixelFormat !== "ya8") data[i + 3] = 255;
              else if (previousPixelFormat !== "ya8") {
                // Match swscale's rounded alpha conversion from RGB to YA8.
                data[i + 3] = Math.min(255, Math.round(data[i + 3]! * 257 / 256));
              }
            }
            return { ...f, data };
          }, signal);
        }
      }
    } else if (name === "fps") {
      const options: Record<string, string> = {};
      const keys = ["fps", "start_time", "round", "eof_action"];
      for (const [index, part] of (argStr ? positional : []).entries()) {
        const separator = part.indexOf("=");
        const key = separator < 0 ? keys[index] : part.slice(0, separator).trim();
        if (!key || !keys.includes(key)) throw new Error(`fps: unsupported option ${key ?? part}`);
        options[key] = (separator < 0 ? part : part.slice(separator + 1)).trim();
      }
      const targetFps = parseFilterExpression(options.fps ?? "25", "fps", {
        source_fps: 1 / current[0]!.durationSeconds,
        ntsc: 30000 / 1001, pal: 25, film: 24, "ntsc_film": 24000 / 1001
      });
      if (targetFps <= 0) throw new Error("fps: frame rate must be positive");
      const startTime = options.start_time === undefined ? undefined : parseFilterExpression(options.start_time, "fps", {});
      if (options.round !== undefined && !["zero", "inf", "down", "up", "near", "0", "1", "2", "3", "5"].includes(options.round)) {
        throw new Error("fps: invalid round value");
      }
      if (options.eof_action !== undefined && !["round", "pass", "0", "1"].includes(options.eof_action)) {
        throw new Error("fps: invalid eof_action value");
      }
      const rounding = options.round ?? "near";
      const roundTimestamp = (rounding === "zero" || rounding === "0") ? Math.trunc
        : (rounding === "down" || rounding === "2") ? Math.floor
        : (rounding === "up" || rounding === "3") ? Math.ceil
        : (rounding === "inf" || rounding === "1") ? (value: number) => Math.sign(value) * Math.ceil(Math.abs(value))
        : (value: number) => Math.sign(value) * Math.floor(Math.abs(value) + 0.5);
      // FFmpeg rounds the requested start separately in the input and output time bases.
      const inputOffset = startTime === undefined ? 0 : roundTimestamp(startTime * timescale) / timescale;
      const outputOffset = startTime === undefined ? 0 : roundTimestamp(startTime * targetFps);
      const last = current[current.length - 1]!;
      const endTime = last.ptsSeconds + last.durationSeconds;
      const endTimestamp = options.eof_action === "pass" || options.eof_action === "1"
        ? Math.ceil(endTime * targetFps)
        : roundTimestamp(endTime * targetFps);
      const firstTimestamp = startTime === undefined ? roundTimestamp(current[0]!.ptsSeconds * targetFps) : outputOffset;
      const resampled: MediaVideoFrame[] = [];
      let srcIdx = 0;
      for (let i = firstTimestamp; i < endTimestamp; i++) {
        if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

        // Round presentation timestamps to the output time base, as FFmpeg does.
        while (srcIdx + 1 < current.length && outputOffset + roundTimestamp((current[srcIdx + 1]!.ptsSeconds - inputOffset) * targetFps) <= i) {
          srcIdx++;
        }
        const src = current[srcIdx]!;
        resampled.push({
          ...src,
          ptsSeconds: i / targetFps,
          durationSeconds: 1 / targetFps
        });
      }
      current = resampled;
      timescale = targetFps;
    } else if (name === "trim") {
      // FFmpeg positional options skip aliases; integer bounds use lrint rounding.
      let sawNamed = false;
      for (const [index, value] of (argStr ? positional : []).entries()) {
        if (value.includes("=")) {
          sawNamed = true;
          continue;
        }
        const key = ["start", "end", "start_pts", "end_pts", "duration", "start_frame", "end_frame"][index];
        if (sawNamed || key === undefined) throw new Error("trim: unsupported positional option");
        named[key] ??= index === 2 || index === 3 || index >= 5
          ? (value.trim() ? String(roundToEven(Number(value))) : "")
          : value.trim();
      }
      for (const option of Object.keys(named)) {
        if (!["start", "end", "duration", "start_frame", "end_frame", "start_pts", "end_pts"].includes(option)) {
          throw new Error(`trim: unsupported option ${option}`);
        }
      }
      for (const option of ["start_frame", "end_frame"]) {
        const value = named[option];
        if (option === "start_frame" && Number(value) === -1) {
          delete named[option];
          continue;
        }
        if (value !== undefined && (!value || !Number.isSafeInteger(Number(value)) || Number(value) < 0)) {
          throw new Error(`trim: ${option} must be a nonnegative integer${option === "start_frame" ? " or -1 (unset)" : ""}`);
        }
      }
      for (const option of ["start_pts", "end_pts"]) {
        const value = named[option];
        if (value !== undefined && (!value || !Number.isSafeInteger(Number(value)))) {
          throw new Error(`trim: ${option} must be an integer`);
        }
      }
      const start = named.start;
      // FFmpeg rescales duration options to input ticks, rounding ties away from zero.
      const roundTime = (value: string) => {
        const ticks = parseHlsDuration(value) * timescale;
        return Math.sign(ticks) * Math.floor(Math.abs(ticks) + 0.5) / timescale;
      };
      const st = Math.min(start === undefined ? Infinity : roundTime(start),
        named.start_pts === undefined ? Infinity : Number(named.start_pts) / timescale);
      const startFrame = named.start_frame === undefined ? undefined : Number(named.start_frame);
      const endFrame = named.end_frame === undefined ? undefined : Number(named.end_frame);
      const end = Math.max(named.end === undefined ? -Infinity : roundTime(named.end),
        named.end_pts === undefined ? -Infinity : Number(named.end_pts) / timescale);
      const duration = named.duration === undefined ? undefined : parseHlsDuration(named.duration);
      const dur = named.duration === undefined ? undefined : roundTime(named.duration);
      for (const [option, raw, value] of [["start", start, st], ["end", named.end, end], ["duration", named.duration, dur]] as const) {
        if (raw !== undefined && !Number.isFinite(value)) {
          throw new Error(`trim: invalid ${option} duration: ${raw}`);
        }
      }
      let firstPts: number | undefined;
      current = current
        .filter((f, index) => {
          const afterStart = startFrame === undefined
            ? st === Infinity || f.ptsSeconds >= st
            : index >= startFrame || f.ptsSeconds >= st;
          if (!afterStart) return false;
          firstPts ??= f.ptsSeconds;
          const finalEnd = dur !== undefined && duration !== 0 ? Math.max(end, firstPts + dur) : end;
          const beforeEnd = endFrame === undefined
            ? finalEnd === -Infinity || f.ptsSeconds < finalEnd
            : index < endFrame || (Number.isFinite(finalEnd) && f.ptsSeconds < finalEnd);
          return afterStart && beforeEnd;
        });
    } else if (name === "drawtext") {
      const rawText = (named.text ?? positional[0] ?? "").replace(/^['"]|['"]$/g, "");
      const fontSize = parseInt(named.fontsize ?? "12", 10) || 12;
      const fontColor = parseColorRgba(named.fontcolor ?? "white");
      const drawBox = named.box === "1" || named.box === "true";
      const boxColor = parseColorRgba(named.boxcolor ?? "black");
      current = await mapWork(current, async (f, fIdx) => {


        const expanded = rawText
          .replace(/%\{frame_num\}/g, String(fIdx))
          .replace(/%\{n\}/g, String(fIdx))
          .replace(/%\{pts\}/g, f.ptsSeconds.toFixed(2));
        return {
          ...f,
          data: await renderBitmapTextToRgba(f.data, f.width, f.height, expanded, {
            xExpr: named.x ?? "4",
            yExpr: named.y ?? "4",
            fontSize,
            fontColor,
            drawBox,
            boxColor
          }, signal)
        };
      }, signal);
    } else if (name === "subtitles" || name === "ass") {
      const keys = name === "ass" ? ["filename", "original_size", "fontsdir", "alpha"]
        : ["filename", "original_size", "fontsdir", "alpha", "charenc", "stream_index", "force_style", "wrap_unicode"];
      for (const key of Object.keys(named)) {
        if (!keys.includes(key) && key !== "f" && !(name === "subtitles" && key === "si")) {
          throw new Error(`${name}: unknown option ${key}`);
        }
      }
      for (const [index, value] of positional.entries()) {
        if (value.includes("=")) continue;
        const key = keys[index];
        if (!key) throw new Error(`${name}: too many positional options`);
        named[key] ??= value;
      }
      if (named.alpha !== undefined && !["0", "1", "true", "false", "yes", "no", "on", "off"].includes(named.alpha.toLowerCase())) {
        throw new Error(`${name}: invalid alpha boolean`);
      }
      const filename = named.filename ?? named.f;
      if (!filename) throw new Error(`${name}: filename is required`);
      const originalSize = named.original_size?.split("x").map(Number);
      if (originalSize && (originalSize.length !== 2 || originalSize.some(value => !Number.isInteger(value) || value <= 0 || value > 2147483647))) {
        throw new Error("subtitles: invalid original_size");
      }
      let alignment = 2;
      let fontColor: [number, number, number, number] = [255, 255, 255, 255];
      for (const override of (named.force_style ?? "").split(",")) {
        const equals = override.indexOf("=");
        if (equals < 0) continue;
        const key = override.slice(0, equals).trim().toLowerCase();
        const value = override.slice(equals + 1).trim();
        if (key === "primarycolour") {
          // ASS colors are &HAABBGGRR, with inverted alpha (00 is opaque).
          const color = value.toLowerCase().startsWith("&h")
            ? parseInt(value.slice(2), 16) : Number(value);
          if (Number.isFinite(color)) fontColor = [color & 255, (color >>> 8) & 255, (color >>> 16) & 255, 255 - ((color >>> 24) & 255)];
        } else if (key === "alignment" && Number.isInteger(Number(value))) {
          // libass force_style uses SSA alignment bits, not ASS numpad positions.
          alignment = Number(value);
        }
      }
      const bytes = await readSubtitle(filename);
      const plugin = name === "ass" ? assAst() : registry.detect(bytes, filename);
      if (!plugin) throw new Error("Unable to detect subtitle input format");
      const doc = plugin.parse(bytes, { filename, budget, decodeAudio: false });
      const streamIndex = Number(named.si ?? named.stream_index ?? -1);
      const track = streamIndex === -1 ? doc.tracks.find(t => t.type === "subtitle") : doc.tracks[streamIndex];
      if (!track || track.type !== "subtitle") throw new Error("Unable to locate subtitle stream");
      const timescale = track?.timescale || 1000;
      const cues = track?.samples.map(sample => ({
        startSec: sample.pts / timescale,
        endSec: (sample.pts + sample.duration) / timescale,
        text: decodeUtf8(sample.data).trim()
      })) ?? [];
      current = await mapWork(current, async (f) => {


        const active = cues.filter((c) => f.ptsSeconds >= c.startSec && f.ptsSeconds < c.endSec);
        if (active.length === 0) return f;
        const cueStr = active.map((c) => c.text).join("\n");
        return {
          ...f,
          data: await renderBitmapTextToRgba(f.data, f.width, f.height, cueStr, {
            xExpr: (alignment & 3) === 2 ? "(w-text_w)/2"
              : (alignment & 3) === 3 ? `w-text_w-${Math.round(10 * f.width / 384)}`
                : String(Math.round(10 * f.width / 384)),
            // FFmpeg's default SRT style uses a 16-point font and 10-point
            // vertical margin on a 288-pixel reference canvas.
            yExpr: alignment & 4 ? String(Math.round(10 * f.height / 288))
              : alignment & 8 ? "(h-text_h)/2"
                : `h-text_h-${Math.max(4, Math.round(10 * f.height / 288))}`,
            fontSize: 16 * f.height / 288,
            // Match libass's pixel aspect correction for the original canvas.
            horizontalScale: originalSize ? f.width * originalSize[1]! / (f.height * originalSize[0]!) : 1,
            fontColor,
            drawBox: true,
            boxColor: [0, 0, 0, 180],
            preserveAlpha: !["1", "true", "yes", "on"].includes((named.alpha ?? "0").toLowerCase())
          }, signal)
        };
      }, signal);
    } else if (name === "untile") {
      const layout = named.layout ?? positional[0] ?? "";
      const dimensions = (layout || "6x5").split("x");
      const cols = Number(dimensions[0]);
      const rows = Number(dimensions[1]);
      if (positional.length > 1 || Object.keys(named).some(key => key !== "layout") ||
          dimensions.length !== 2 || !Number.isInteger(cols) || !Number.isInteger(rows) ||
          cols <= 0 || rows <= 0 || cols * rows > 4294967295) {
        throw new Error("untile: invalid layout");
      }
      const count = cols * rows;
      const durationSeconds = current[0]!.durationSeconds / count;
      const extracted: MediaVideoFrame[] = [];
      for (const frame of current) {
        if (frame.width % cols || frame.height % rows) {
          throw new Error("untile: input dimensions must be multiples of the layout");
        }
        const width = frame.width / cols;
        const height = frame.height / rows;
        for (let cell = 0; cell < count; cell++) {
          budget.recordFrame(width, height);
          budget.allocateMemory(width * height * 4);
          const data = new Uint8Array(width * height * 4);
          const x = (cell % cols) * width;
          const y = Math.floor(cell / cols) * height;
          for (let row = 0; row < height; row++) {
            if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            const start = ((y + row) * frame.width + x) * 4;
            data.set(frame.data.subarray(start, start + width * 4), row * width * 4);
          }
          extracted.push({ ...frame, width, height, data,
            ptsSeconds: frame.ptsSeconds + cell * durationSeconds, durationSeconds });
        }
      }
      current = extracted;
    } else if (name === "tile") {
      const keys = ["layout", "nb_frames", "margin", "padding", "color", "overlap", "init_padding"];
      for (const key of Object.keys(named)) {
        if (!keys.includes(key)) throw new Error(`tile: unknown option ${key}`);
      }
      for (const [index, value] of positional.entries()) {
        if (!value || value.includes("=")) continue;
        const key = keys[index];
        if (!key) throw new Error("tile: too many positional options");
        named[key] ??= value;
      }
      const dimensions = (named.layout ?? "6x5").toLowerCase().split("x");
      if (dimensions.length !== 2 || dimensions.some(value =>
        !value || [...value].some(char => char < "0" || char > "9") ||
        !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 2147483647)) {
        throw new Error("tile: layout must contain two positive integer dimensions");
      }
      const cols = Number(dimensions[0]);
      const rows = Number(dimensions[1]);
      if (cols * rows > 2147483647) throw new Error("tile: layout has too many cells");
      for (const key of ["nb_frames", "margin", "padding"]) {
        const value = Number(named[key] ?? 0);
        const max = key === "nb_frames" ? cols * rows : 1024;
        if (named[key]?.trim() === "" || !Number.isInteger(value) || value < 0 || value > max) {
          throw new Error(`tile: ${key} must be an integer from 0 to ${max}`);
        }
      }
      const padding = Number(named.padding ?? 0);
      const margin = Number(named.margin ?? 0);
      const color = parseColorRgba(named.color ?? "black");
      const perTile = Number(named.nb_frames ?? 0) || cols * rows;
      const overlap = Number(named.overlap ?? 0);
      if (!Number.isInteger(overlap) || overlap < 0 || overlap > 2147483647) {
        throw new Error("tile: overlap must be an integer from 0 to 2147483647");
      }
      const initPadding = Number(named.init_padding ?? 0);
      if (!Number.isInteger(initPadding) || initPadding < 0 || initPadding > 2147483647) {
        throw new Error("tile: init_padding must be an integer from 0 to 2147483647");
      }
      const step = perTile - Math.min(overlap, perTile - 1);
      const tiledFrames: MediaVideoFrame[] = [];
      for (let base = initPadding < perTile ? -initPadding : 0; base < current.length; base += step) {
        if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

        const batch = current.slice(Math.max(0, base), base + perTile);
        const fw = batch[0]?.width ?? 64;
        const fh = batch[0]?.height ?? 64;
        const outW = margin * 2 + cols * fw + Math.max(0, cols - 1) * padding;
        const outH = margin * 2 + rows * fh + Math.max(0, rows - 1) * padding;
        const canvas = new Uint8Array(outW * outH * 4);
        for (let i = 0; i < canvas.byteLength; i += 4) canvas.set(color, i);
        for (let k = 0; k < batch.length; k++) {
          if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

          const tileFrame = batch[k]!;
          const cell = k + Math.max(0, -base);
          const c = cell % cols;
          const r = Math.floor(cell / cols);
          const ox = margin + c * (fw + padding);
          const oy = margin + r * (fh + padding);
          for (let y = 0; y < Math.min(fh, tileFrame.height); y++) {
            if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

            const srcRow = tileFrame.data.subarray(y * tileFrame.width * 4, (y + 1) * tileFrame.width * 4);
            canvas.set(srcRow.subarray(0, fw * 4), ((oy + y) * outW + ox) * 4);
          }
        }
        tiledFrames.push({
          width: outW,
          height: outH,
          data: canvas,
          ptsSeconds: batch[0]?.ptsSeconds ?? 0,
          durationSeconds: batch.reduce((s, x) => s + x.durationSeconds, 0),
          keyframe: true
        });
        if (base + perTile >= current.length) break;
      }
      current = tiledFrames;
    } else if (name === "select") {
      const expr = named.e ?? named.expr ?? positional[0] ?? "1";
      const variables = {
        n: 0, t: NaN, key: 0, selected_n: 0,
        prev_selected_n: NaN, prev_selected_t: NaN, prev_t: NaN,
        start_t: current[0]?.ptsSeconds ?? NaN
      };
      if (current.length === 0) parseFilterExpression(expr, "select", variables);
      current = current.filter((f, n) => {
        variables.n = n;
        variables.t = f.ptsSeconds;
        variables.key = Number(f.keyframe);
        const selected = parseFilterExpression(expr, "select", variables) !== 0;
        variables.prev_t = f.ptsSeconds;
        if (selected) {
          variables.selected_n++;
          variables.prev_selected_n = n;
          variables.prev_selected_t = f.ptsSeconds;
        }
        return selected;
      });
    } else if (name === "decimate") {
      const cycle = Number(named.cycle ?? (argStr || "5"));
      if (positional.length > 1 || Object.keys(named).some(key => key !== "cycle") ||
          !Number.isInteger(cycle) || cycle < 2 || cycle > 25) {
        throw new Error("decimate: only cycle is supported; expected an integer from 2 to 25");
      }
      current = await decimate(current, cycle, budget, signal);
    } else if (name === "mpdecimate") {
      if (argStr) throw new Error("mpdecimate: custom options are unsupported");
      const retained: typeof current = [];
      for (const frame of current) {
        if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        const reference = retained.at(-1);
        let changed = !reference || frame.width !== reference.width || frame.height !== reference.height;
        if (reference && !changed) {
          // Compare overlapping 8x8 RGB blocks with FFmpeg's default thresholds.
          // The reference is the last retained frame, so small changes accumulate.
          const lowBlockLimit = Math.floor(Math.floor(frame.width / 16) * Math.floor(frame.height / 16) * 0.33);
          for (let channel = 0; channel < 3 && !changed; channel++) {
            let lowBlocks = 0;
            for (let y = 0; y + 8 <= frame.height && !changed; y += 4) {
              for (let x = 8; x + 8 <= frame.width && !changed; x += 4) {
                if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
                let difference = 0;
                for (let row = y; row < y + 8; row++) {
                  for (let column = x; column < x + 8; column++) {
                    const offset = (row * frame.width + column) * 4 + channel;
                    difference += Math.abs(frame.data[offset]! - reference.data[offset]!);
                  }
                }
                changed = difference > 768 || (difference > 320 && ++lowBlocks > lowBlockLimit);
              }
            }
          }
        }
        if (changed) retained.push(frame);
      }
      current = retained;
    } else if (name === "framestep") {
      const step = Number(named.step ?? (argStr || "1"));
      if (positional.length > 1 || Object.keys(named).some(key => key !== "step") ||
          !Number.isInteger(step) || step < 1 || step > 2147483647) {
        throw new Error("framestep: step must be an integer from 1 to 2147483647");
      }
      current = current.filter((_, index) => index % step === 0);
    } else if (name === "tinterlace") {
      const mode = named.mode ?? argStr;
      if (positional.length !== 1 || Object.keys(named).some(key => key !== "mode") ||
          !["interleave_top", "4"].includes(mode)) {
        throw new Error("tinterlace: only mode=interleave_top is supported");
      }
      const output: typeof current = [];
      for (let index = 0; index + 1 < current.length; index += 2) {
        const first = current[index]!;
        const second = current[index + 1]!;
        if (first.width !== second.width || first.height !== second.height) {
          throw new Error("tinterlace: adjacent frames must have matching dimensions");
        }
        budget.allocateMemory(first.data.byteLength + 128);
        const data = new Uint8Array(first.data.byteLength);
        const stride = first.width * 4;
        for (let row = 0; row < first.height; row++) {
          if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          const source = row % 2 === 0 ? first : second;
          data.set(source.data.subarray(row * stride, (row + 1) * stride), row * stride);
        }
        const combined = { ...first, data, durationSeconds: first.durationSeconds + second.durationSeconds };
        delete combined.native;
        output.push(combined);
      }
      current = output;
    } else if (name === "telecine") {
      const options = { first_field: "top", pattern: "23" };
      for (const [index, part] of (argStr ? positional : []).entries()) {
        const separator = part.indexOf("=");
        const key = separator < 0 ? ["first_field", "pattern"][index] : part.slice(0, separator).trim();
        if (key !== "first_field" && key !== "pattern") throw new Error("telecine: unsupported option");
        options[key] = (separator < 0 ? part : part.slice(separator + 1)).trim();
      }
      const fieldOrder = ["top", "t", "0"].includes(options.first_field) ? 0
        : ["bottom", "b", "1"].includes(options.first_field) ? 1 : -1;
      const pattern = Array.from(options.pattern, digit => digit.charCodeAt(0) - 48);
      const fieldsPerCycle = pattern.reduce((sum, count) => sum + count, 0);
      if (fieldOrder < 0 || !pattern.length || pattern.some(count => count < 0 || count > 9) || !fieldsPerCycle) {
        throw new Error("telecine: expected first_field=top or bottom and a nonzero digit pattern");
      }
      const durationSeconds = (current[0]?.durationSeconds ?? 0) * 2 * pattern.length / fieldsPerCycle;
      const start = current[0]?.ptsSeconds ?? 0;
      const output: typeof current = [];
      let pending: typeof current[number] | undefined;
      for (const [index, frame] of current.entries()) {
        for (let field = 0; field < pattern[index % pattern.length]!; field++) {
          if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          if (!pending) {
            pending = frame;
            continue;
          }
          if (pending.width !== frame.width || pending.height !== frame.height) {
            throw new Error("telecine: adjacent fields must have matching dimensions");
          }
          budget.checkSamples(output.length + 1);
          budget.allocateMemory(128);
          let data = frame.data;
          if (pending !== frame) {
            budget.allocateMemory(frame.data.byteLength);
            data = new Uint8Array(frame.data.byteLength);
            const stride = frame.width * 4;
            for (let row = 0; row < frame.height; row++) {
              if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
              const source = row % 2 === fieldOrder ? pending : frame;
              data.set(source.data.subarray(row * stride, (row + 1) * stride), row * stride);
            }
          }
          const combined = { ...frame, data, ptsSeconds: start + output.length * durationSeconds, durationSeconds };
          if (pending !== frame) delete combined.native;
          output.push(combined);
          pending = undefined;
        }
      }
      current = output;
    } else if (name === "tmix") {
      current = await tmix(current, argStr, budget, signal);
    } else if (name === "tblend") {
      if (positional.length !== 1 || named.all_mode !== "difference" || Object.keys(named).length !== 1) {
        throw new Error("tblend: only all_mode=difference is supported");
      }
      const blended: typeof current = [];
      for (let index = 1; index < current.length; index++) {
        const frame = current[index]!;
        const previous = current[index - 1]!;
        if (frame.width !== previous.width || frame.height !== previous.height) {
          throw new Error("tblend: adjacent frames must have matching dimensions");
        }
        const data = new Uint8Array(frame.data.length);
        for (let offset = 0; offset < data.length; offset += 4) {
          if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          for (let channel = 0; channel < 3; channel++) {
            data[offset + channel] = Math.abs(frame.data[offset + channel]! - previous.data[offset + channel]!);
          }
          data[offset + 3] = 255;
        }
        const output = { ...frame, data };
        delete output.native;
        blended.push(output);
      }
      current = blended;
    } else if (name === "shuffleframes") {
      const mapping = (named.mapping ?? (argStr || "0")).split("|").join(" ").split(" ").filter(Boolean).map(Number);
      if (positional.length > 1 || Object.keys(named).some(key => key !== "mapping") ||
          mapping.length === 0 || mapping.some(index => !Number.isInteger(index) || index < -1 || index >= mapping.length)) {
        throw new Error("shuffleframes: mapping must contain frame indices from -1 to the group size minus one");
      }
      const shuffled: typeof current = [];
      for (let base = 0; base + mapping.length <= current.length; base += mapping.length) {
        for (let slot = 0; slot < mapping.length; slot++) {
          if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          const index = mapping[slot]!;
          if (index >= 0) {
            shuffled.push({ ...current[base + index]!, ptsSeconds: current[base + slot]!.ptsSeconds });
          }
        }
      }
      current = shuffled;
    } else if (name === "loop") {
      const values = { loop: 0, size: 0, start: 0 };
      for (const [index, option] of (argStr ? argStr.split(":") : []).entries()) {
        const separator = option.indexOf("=");
        const key = separator < 0 ? ["loop", "size", "start"][index] : option.slice(0, separator).trim();
        if (key !== "loop" && key !== "size" && key !== "start") throw new Error(`loop: unsupported option ${key}`);
        const text = (separator < 0 ? option : option.slice(separator + 1)).trim();
        const value = Number(text);
        const max = key === "loop" ? 2147483647 : key === "size" ? 32767 : Number.MAX_SAFE_INTEGER;
        if (!text || !Number.isSafeInteger(value) || value < 0 || value > max) {
          throw new Error(`loop: ${key} must be a finite nonnegative integer no greater than ${max}`);
        }
        values[key] = value;
      }
      // FFmpeg starts buffering when its one-based input count reaches start.
      const start = Math.max(0, values.start - 1);
      const size = Math.min(values.size, Math.max(0, current.length - start));
      if (values.loop > 0 && size > 0) {
        const end = start + size;
        const first = current[start]!;
        const last = current[end - 1]!;
        const duration = last.ptsSeconds + last.durationSeconds - first.ptsSeconds;
        const added = values.loop * size;
        const count = current.length + added;
        if (!Number.isSafeInteger(count) || count > 4294967295) throw new Error("loop: output frame count is too large");
        budget.checkSamples(count);
        budget.checkDuration(current[current.length - 1]!.ptsSeconds + current[current.length - 1]!.durationSeconds + values.loop * duration);
        budget.allocateMemory(count * 128);
        const repeated: MediaVideoFrame[] = current.slice(0, end);
        for (let index = 0; index < added; index++) {
          if (index % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          const frame = current[start + index % size]!;
          budget.recordFrame(frame.width, frame.height);
          repeated.push({ ...frame, ptsSeconds: frame.ptsSeconds + (Math.floor(index / size) + 1) * duration });
        }
        for (let index = end; index < current.length; index++) {
          const frame = current[index]!;
          repeated.push({ ...frame, ptsSeconds: frame.ptsSeconds + values.loop * duration });
        }
        current = repeated;
      }
    } else if (name === "reverse") {
      // Reverse pictures while retaining the input's ordered timestamp slots.
      current = await mapWork([...current].reverse(), (f, index) => ({
        ...f, ptsSeconds: current[index]!.ptsSeconds
      }), signal);
    } else if (name === "setpts") {
      const expr = (named.expr ?? positional[0] ?? "PTS").toUpperCase();
      const startPts = (current[0]?.ptsSeconds ?? 0) * timescale;
      current = await mapWork(current, async (f) => ({
        ...f,
        ptsSeconds: Math.trunc(parseFilterExpression(expr, "setpts", {
          PTS: f.ptsSeconds * timescale, STARTPTS: startPts
        })) / timescale
      }), signal);
    } else if (name === "drawbox") {
      const values = positional.map(part => part === "" || part.includes("=") ? undefined : part);
      for (const key of Object.keys(named)) {
        if (!["x", "y", "w", "width", "h", "height", "c", "color", "t", "thickness", "replace", "box_source", "enable"].includes(key)) {
          throw new Error(`drawbox: unsupported option ${key}`);
        }
      }
      if (positional.some((part, index) => index > 7 && !part.includes("="))) {
        throw new Error("drawbox: too many positional options");
      }
      const boxSource = named.box_source ?? values[7];
      if (boxSource !== undefined && boxSource !== "side_data_detection_bboxes") {
        throw new Error("drawbox: unsupported box source");
      }
      const replaceOption = named.replace ?? values[6] ?? "0";
      if (!["0", "1", "false", "true", "no", "yes", "off", "on"].includes(replaceOption)) {
        throw new Error("drawbox: invalid replace boolean");
      }
      const color = named.color ?? named.c ?? values[4] ?? "black";
      const invert = color === "invert";
      const col = parseColorRgba(invert ? "black" : color);
      // FFmpeg uses limited-range BT.601 integer coefficients for drawbox colors.
      const [r, g, b] = col;
      const yuvColor = [
        (263 * r + 516 * g + 100 * b + 512 + (16 << 10)) >> 10,
        ((-152 * r - 298 * g + 450 * b + 511) >> 10) + 128,
        ((450 * r - 377 * g - 73 * b + 511) >> 10) + 128
      ];
      const yuvAlpha = col[3] / 255;
      // Native packed-RGB drawbox blends with single-precision arithmetic.
      const alpha = Math.fround(col[3] / 255);
      const inverseAlpha = Math.fround(1 - alpha);
      const thicknessOption = named.t ?? named.thickness ?? values[5] ?? "3";
      const replace = ["1", "true", "yes", "on"].includes(replaceOption);
      current = await mapWork(current, async (f, n) => {
        let work = 0;

        const variables = {
          iw: f.width, ih: f.height, in_w: f.width, in_h: f.height,
          x: NaN, y: NaN, w: NaN, h: NaN, t: NaN
        };
        // Match FFmpeg's six passes so geometry can refer to later expressions.
        for (let pass = 0; pass < 6; pass++) {
          variables.x = parseFilterExpression(named.x ?? values[0] ?? "0", "drawbox", variables);
          variables.y = parseFilterExpression(named.y ?? values[1] ?? "0", "drawbox", variables);
          variables.w = parseFilterExpression(named.w ?? named.width ?? values[2] ?? "0", "drawbox", variables);
          variables.h = parseFilterExpression(named.h ?? named.height ?? values[3] ?? "0", "drawbox", variables);
          variables.t = thicknessOption === "fill" ? 2147483647
            : parseFilterExpression(thicknessOption, "drawbox", variables);
        }
        if (![variables.x, variables.y, variables.w, variables.h, variables.t].every(Number.isFinite)) {
          throw new Error("drawbox: invalid or unsupported expression");
        }
        if (named.enable !== undefined && Math.abs(parseFilterExpression(named.enable, "drawbox enable", {
          n, t: f.ptsSeconds, w: f.width, h: f.height
        })) < 0.5) return f;
        // Decoded frames carry no detection bounding-box side data.
        if (boxSource === "side_data_detection_bboxes") return f;
        const width = Math.trunc(variables.w);
        const height = Math.trunc(variables.h);
        const bw = width <= 0 ? f.width : width;
        const bh = height <= 0 ? f.height : height;
        const bx = Math.trunc(variables.x);
        const by = Math.trunc(variables.y);
        const thickness = Math.trunc(variables.t);
        const source = f.native;
        const planar = source && source.rgba === f.data && source.width === f.width && source.height === f.height &&
          [0, 4, 5, 12, 13, 14].includes(source.format) ? source : undefined;
        const hsub = planar && [0, 4, 12, 13].includes(planar.format) ? 1 : 0;
        const vsub = planar && [0, 12].includes(planar.format) ? 1 : 0;
        const chromaWidth = Math.ceil(f.width / (1 << hsub));
        const chromaSize = chromaWidth * Math.ceil(f.height / (1 << vsub));
        const lumaSize = f.width * f.height;
        const nextData = new Uint8Array(planar ? planar.pixels : f.data);
        for (let y = Math.max(0, by); y < Math.min(f.height, by + bh); y++) {
          if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

          for (let x = Math.max(0, bx); x < Math.min(f.width, bx + bw); x++) {
            if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }

            if (Math.min(x - bx, y - by, bx + bw - 1 - x, by + bh - 1 - y) >= thickness) continue;
            if (invert) {
              if (planar) {
                const index = y * f.width + x;
                nextData[index] = 255 - nextData[index]!;
              } else {
                const index = (y * f.width + x) * 4;
                for (let channel = 0; channel < 3; channel++) {
                  nextData[index + channel] = 255 - nextData[index + channel]!;
                }
              }
              continue;
            }
            if (planar) {
              // Native drawbox updates shared chroma once per covered luma pixel,
              // including repeated alpha blends and pixels just outside box edges.
              const chromaIndex = (y >> vsub) * chromaWidth + (x >> hsub);
              const indices = [y * f.width + x, lumaSize + chromaIndex, lumaSize + chromaSize + chromaIndex];
              for (let plane = 0; plane < 3; plane++) {
                const index = indices[plane]!;
                nextData[index] = (1 - yuvAlpha) * nextData[index]! + yuvAlpha * yuvColor[plane]!;
              }
              continue;
            }
            const idx = (y * f.width + x) * 4;
            if (replace) {
              nextData.set(col, idx);
              continue;
            }
            for (let channel = 0; channel < 3; channel++) {
              nextData[idx + channel] = Math.fround(
                Math.fround(nextData[idx + channel]! * inverseAlpha) + Math.fround(col[channel]! * alpha)
              );
            }
          }
        }
        if (planar) {
          const native = { ...planar, pixels: nextData };
          const data = scaleVideoPicture({ ...f, native }, f.width, f.height)!;
          return { ...f, data, native: { ...native, rgba: data } };
        }
        return { ...f, data: nextData };
      }, signal);
    } else if (name !== "format" && name !== "null") {
      throw new Error(`Unsupported video filter: ${name}`);
    }
  }

  return current;
}

function outputChapters(
  chapters: MediaDocument["chapters"],
  startSeconds = 0,
  durationSeconds?: number,
  endSeconds = Infinity
): MediaDocument["chapters"] {
  const end = durationSeconds === undefined ? endSeconds : startSeconds + durationSeconds;
  return chapters?.filter(chapter => chapter.endTimeSeconds >= startSeconds && chapter.startTimeSeconds < end)
    .map(chapter => ({
      ...chapter,
      startTimeSeconds: Math.max(0, chapter.startTimeSeconds - startSeconds),
      endTimeSeconds: Math.min(end, chapter.endTimeSeconds) - startSeconds
    }));
}

function mapGlobalMetadata(documents: readonly MediaDocument[], sources: readonly number[]): Mp4MetadataTags {
  let metadata: Mp4MetadataTags = {};
  for (const source of sources.length ? sources : [0]) {
    if (source >= documents.length) throw new Error(`Invalid metadata input index: ${source}`);
    if (source < 0) continue;
    const document = documents[source]!;
    const tags = document.metadata;
    const custom = { ...tags.custom };
    if (document.containerFormat === "mp4" || document.containerFormat === "mov") {
      if (document.majorBrand !== undefined) custom.major_brand = document.majorBrand;
      if (document.minorVersion !== undefined) custom.minor_version = String(document.minorVersion);
      if (document.compatibleBrands?.length) custom.compatible_brands = document.compatibleBrands.join("");
    }
    if (sources.length === 0) delete custom.creation_time;
    metadata = {
      ...Object.fromEntries(Object.entries(tags).filter(([, value]) => value !== undefined)),
      ...metadata,
      custom: { ...custom, ...metadata.custom }
    };
  }
  return metadata;
}

function validateMetadataStreamSpecifier(specifier: string): void {
  const parts = specifier.split(":");
  const isIndex = (value: string | undefined) => value !== undefined && value.length > 0 &&
    Array.from(value).every(char => char >= "0" && char <= "9");
  while (parts.length) {
    const selector = parts.shift()!;
    if (["a", "v", "V", "s", "d", "t"].includes(selector)) continue;
    if (selector === "p" && isIndex(parts.shift())) continue;
    if (selector === "m" && parts.length > 0) return;
    if (selector === "i" && parts.length === 1 && isIndex(parts[0])) return;
    if (selector.startsWith("#") && parts.length === 0 && isIndex(selector.slice(1))) return;
    if (parts.length === 0 && (selector === "" || selector === "u" || isIndex(selector))) return;
    throw new Error(`Invalid stream specifier: ${specifier}`);
  }
}

function metadataMapTracks(tracks: readonly MediaTrack[], specifier: string): readonly MediaTrack[] {
  if (!specifier) return tracks;
  const parts = specifier.split(":");
  const type = ({ a: "audio", v: "video", s: "subtitle", d: "data" } as Record<string, string>)[parts[0]!];
  if (type) parts.shift();
  const index = parts[0];
  if (parts.length > 1 || (index !== undefined && (!index.length ||
      !Array.from(index).every(char => char >= "0" && char <= "9")))) {
    throw new Error(`Invalid stream specifier: ${specifier}`);
  }
  const candidates = type ? tracks.filter(track => track.type === type) : tracks;
  return index === undefined ? candidates : candidates.filter((_, ordinal) => ordinal === Number(index));
}

function mapStreamMetadata(tracks: readonly MediaTrack[], documents: readonly MediaDocument[], maps: readonly [string, string][]): readonly MediaTrack[] {
  if (!maps.length) return tracks;
  // Any explicit stream map disables automatic metadata copying for all streams.
  const tags = tracks.map(() => ({} as Record<string, string>));
  for (const [destination, source] of maps) {
    const selected = metadataMapTracks(tracks, destination);
    const [input, scope, ...specifier] = source.split(":");
    const inputIndex = input?.trim() ? Number(input) : NaN;
    if (!Number.isSafeInteger(inputIndex) || inputIndex >= documents.length) {
      throw new Error(`Invalid metadata input index: ${input}`);
    }
    if (inputIndex < 0) continue;
    if (scope !== "s") throw new Error(`Unsupported metadata source: ${source}`);
    const track = metadataMapTracks(documents[inputIndex]!.tracks, specifier.join(":"))[0];
    if (!track) throw new Error(`Metadata source '${source}' matches no streams`);
    const sourceTags = { ...track.metadata, language: track.language,
      ...(track.handlerName !== undefined ? { handler_name: track.handlerName } : {}) };
    for (const [index, output] of tracks.entries()) {
      if (selected.includes(output)) tags[index] = { ...sourceTags, ...tags[index] };
    }
  }
  return tracks.map((track, index) => {
    const { language, handler_name: handlerName, ...metadata } = tags[index]!;
    return { ...track, language: language ?? "und", handlerName, metadata };
  });
}

function applyStreamMetadata(tracks: readonly MediaTrack[], metadata: readonly [string, "language" | "handlerName" | "timecode" | "title" | "comment" | "stereo_mode", string][], metadataSource: number | undefined): readonly MediaTrack[] {
  if (metadataSource !== undefined && metadataSource < 0) {
    tracks = tracks.map(track => ({ ...track, language: "und" }));
  }
  for (const [specifier, key, value] of metadata) {
    const parts = specifier.split(":");
    const selector = parts[0];
    const type = selector === "a" ? "audio" : selector === "v" ? "video" : selector === "s" ? "subtitle" : undefined;
    const [index, metadataKey, ...valueParts] = type ? parts.slice(1) : parts;
    const metadataValue = valueParts.length ? valueParts.join(":") : undefined;
    let matched = 0;
    tracks = tracks.map(track => {
      if (type && track.type !== type) return track;
      const current = matched++;
      if (index === "m") {
        if (metadataKey !== "language" || track.language === undefined ||
            (metadataValue !== undefined && track.language !== metadataValue)) return track;
      } else if (index && current !== Number(index)) return track;
      if (key === "stereo_mode") {
        const stereoMode = ["mono", "left_right", "bottom_top", "top_bottom", "checkerboard_rl", "checkerboard_lr",
          "row_interleaved_rl", "row_interleaved_lr", "col_interleaved_rl", "col_interleaved_lr", "anaglyph_cyan_red",
          "right_left", "anaglyph_green_magenta", "block_lr", "block_rl"].indexOf(value);
        if (track.type !== "video" || stereoMode < 0) return track;
        return { ...track, codecDescriptions: track.codecDescriptions.map(codec => ({ ...codec, stereoMode })) };
      }
      return key === "timecode" || key === "title" || key === "comment" ? { ...track, metadata: { ...track.metadata, [key]: value } } : { ...track, [key]: value };
    });
  }
  return tracks;
}

function removeTimecode(tracks: readonly MediaTrack[]): readonly MediaTrack[] {
  return tracks.filter(track => track.codecDescriptions[0]?.formatFourCC !== "tmcd").map(track => {
    const { timecode: ignoredTimecode, ...metadata } = track.metadata ?? {};
    return { ...track, timecodeTrackId: undefined, metadata };
  });
}

function applyStreamDispositions(tracks: readonly MediaTrack[], dispositions: readonly [string, string][], container: string | undefined, defaultMode: string): readonly MediaTrack[] {
  let hasExplicitDisposition = false;
  for (const [specifier, value] of dispositions) {
    const parts = specifier.split(":");
    const selector = parts[0];
    const type = selector === "a" ? "audio" : selector === "v" ? "video" : selector === "s" ? "subtitle" : selector === "d" ? "data" : selector === "t" ? "attachment" : undefined;
    const streamParts = type ? parts.slice(1) : parts;
    const [index, key, ...languageParts] = streamParts;
    const language = languageParts.length ? languageParts.join(":") : undefined;
    if (index === "m" ? key === undefined
      : streamParts.length > 1 || (index && !Array.from(index).every(char => char >= "0" && char <= "9"))) {
      throw new Error(`Invalid stream specifier: ${specifier}`);
    }
    let matched = 0;
    tracks = tracks.map(track => {
      if (type && track.type !== type) return track;
      const current = matched++;
      if (index === "m") {
        if (key !== "language" || (language !== undefined && track.language !== language)) return track;
      } else if (index && current !== Number(index)) return track;
      hasExplicitDisposition = true;
      const relative = value.startsWith("+") || value.startsWith("-");
      const operations = value.replaceAll("-", "+-").split("+").filter(Boolean).map(token => {
        const remove = token.startsWith("-");
        const flag = remove ? token.slice(1) : token;
        const name = flag === "1" ? "default" : flag;
        if (!["0", "default", "comment", "attached_pic", "forced", "hearing_impaired", "visual_impaired"].includes(name)) throw new Error(`Unsupported disposition: ${value}`);
        return { name, remove };
      });
      if (!operations.length) throw new Error(`Unsupported disposition: ${value}`);
      let disposition: Record<string, number> = relative ? { ...track.disposition } : {};
      let enabled = relative ? Boolean(track.disposition?.default ?? track.enabled) : false;
      for (const { name, remove } of operations) {
        if (name === "0") { enabled = false; disposition = {}; }
        else if (name === "default") { enabled = !remove; delete disposition.default; }
        else if (remove) delete disposition[name];
        else disposition[name] = 1;
      }
      if (container === "mkv") disposition.default = Number(enabled);
      return { ...track, enabled, disposition };
    });
  }
  // FFmpeg promotes the first of multiple unmarked audio outputs unless a
  // disposition option matched an output stream. Mapping order is preserved.
  if (container === "mkv" && !hasExplicitDisposition) {
    const audio = tracks.filter(track => track.type === "audio");
    if (audio.length > 1 && !audio.some(track => track.disposition?.default ?? track.enabled)) {
      tracks = tracks.map(track => track === audio[0]
        ? { ...track, disposition: { ...track.disposition, default: 1 } } : track);
    }
  }
  if (container === "mkv" || container === "webm") {
    // Matroska treats an omitted FlagDefault as true, including explicitly cleared dispositions.
    tracks = tracks.map(track => ({ ...track, disposition: {
      ...track.disposition, default: track.disposition?.default ?? (track.enabled ? 1 : 0)
    } }));
    if (defaultMode !== "passthrough") {
      for (const type of ["video", "audio", ...(defaultMode === "infer" ? ["subtitle"] : [])]) {
        if (tracks.some(track => track.type === type && track.disposition?.default)) continue;
        const first = tracks.findIndex(track => track.type === type);
        tracks = tracks.map((track, index) => index === first
          ? { ...track, disposition: { ...track.disposition, default: 1 } } : track);
      }
    }
  }
  // The MP4 muxer enables the first audio track if none is marked default.
  if (container === "mp4" && !tracks.some(track => track.type === "audio" && track.enabled)) {
    const firstAudio = tracks.findIndex(track => track.type === "audio");
    tracks = tracks.map((track, index) => index === firstAudio ? { ...track, enabled: true } : track);
  }
  return tracks;
}

function selectAutomaticStreams(documents: readonly MediaDocument[]): MediaDocument[] {
  let selected: MediaTrack | undefined;
  let bestScore = -1;
  let video: MediaTrack | undefined;
  let bestArea = -1;
  for (const document of documents) {
    for (const track of document.tracks) {
      if (track.type === "video") {
        const area = (track.width ?? 0) * (track.height ?? 0);
        if (area > bestArea) { video = track; bestArea = area; }
      }
      if (track.type !== "audio") continue;
      // FFmpeg prefers default audio, then channel count, then input order.
      const score = ((track.disposition?.default ?? track.enabled) ? 1 << 22 : 0)
        + (track.decodedAudio?.channels ?? track.codecDescriptions[0]?.channels ?? 0);
      if (score > bestScore) {
        selected = track;
        bestScore = score;
      }
    }
  }
  return documents.map(document => ({
    ...document,
    attachments: [],
    tracks: document.tracks.filter(track => track.type === "video" ? track === video : track.type !== "audio" || track === selected)
  }));
}

function parseFrameLimit(option: string, value: string | undefined): [string, number] {
  const selector = option === "-vframes" ? "v" : option === "-aframes" ? "a" : option === "-frames" ? "" : option.slice(8);
  const parts = selector.split(":");
  if (["v", "a", "s"].includes(parts[0]!)) parts.shift();
  if (parts.length > 1 || (parts.length === 1 && (!parts[0] && selector !== "" ||
      !Array.from(parts[0]!).every(char => char >= "0" && char <= "9")))) {
    throw new Error(`Invalid frame stream specifier: ${selector}`);
  }
  const limit = parseScaledFrameLimit(value);
  if (!Number.isSafeInteger(limit) || (limit < 0 && !selector.startsWith("a") && !selector.startsWith("v"))) {
    const type = selector.startsWith("a") ? "audio " : selector.startsWith("s") ? "subtitle " : "";
    throw new Error(`invalid ${type}frame limit`);
  }
  return [selector, limit];
}

function outputFrameLimits(tracks: readonly MediaTrack[], options: readonly [string, number][]): (number | undefined)[] {
  return tracks.map((track, trackIndex) => {
    let limit: number | undefined;
    for (const [specifier, value] of options) {
      const [selector, ordinal] = specifier.split(":");
      const type = selector === "v" ? "video" : selector === "a" ? "audio" : selector === "s" ? "subtitle" : undefined;
      if (type && type !== track.type) continue;
      const index = type ? ordinal : selector;
      const current = type ? tracks.slice(0, trackIndex).filter(candidate => candidate.type === type).length : trackIndex;
      if (index && current !== Number(index)) continue;
      limit = value < 0 ? undefined : value;
    }
    return limit;
  });
}

function discardOutputPreroll(
  document: MediaDocument,
  codecs: Partial<Record<MediaTrack["type"], string | undefined>>,
  copyInitialNonKeyframes: boolean
): MediaDocument {
  const tracks = document.tracks.map(track => {
    if (codecs[track.type] !== "copy") return track;
    let offset = 0;
    for (const edit of track.editList ?? []) {
      if (edit.mediaTime < 0) offset += edit.segmentDuration / document.timescale;
      else { offset -= edit.mediaTime / track.timescale; break; }
    }
    const first = track.samples.findIndex(sample => (track.type !== "video" || copyInitialNonKeyframes || sample.isKeyframe) &&
      sample.pts + Math.round(offset * track.timescale) >= 0);
    if (first === 0) return track;
    // Keep the original timestamps and edit list: the next keyframe can leave
    // a gap between the requested output start and the first copied packet.
    return first < 0
      ? { ...track, samples: [], duration: 0, editList: undefined, declaredSampleCount: undefined }
      : { ...track, samples: track.samples.slice(first), declaredSampleCount: undefined };
  });
  const durationSeconds = Math.max(0, ...tracks.map(track => track.duration / track.timescale));
  return { ...document, tracks, durationSeconds, duration: Math.round(durationSeconds * document.timescale) };
}

function limitCopyPackets(
  document: MediaDocument,
  limits: readonly (number | undefined)[],
  codecs: Partial<Record<MediaTrack["type"], string | undefined>>,
  shortest = false
): MediaDocument {
  const offsets = document.tracks.map(track => {
    let offset = 0;
    for (const edit of track.editList ?? []) {
      if (edit.mediaTime < 0) offset += edit.segmentDuration / document.timescale;
      else { offset -= edit.mediaTime / track.timescale; break; }
    }
    return offset;
  });
  let end = shortest ? Math.min(...document.tracks.map(track => track.editList?.length
    ? track.editList.reduce((total, edit) => total + edit.segmentDuration, 0) / document.timescale
    : track.duration / track.timescale)) : Infinity;
  for (const [index, track] of document.tracks.entries()) {
    const limit = limits[index];
    if (codecs[track.type] !== "copy" || limit === undefined || limit > track.samples.length) continue;
    if (limit === 0) { end = -Infinity; break; }
    const last = track.samples[limit - 1]!;
    // FFmpeg's mux synchronization queue compares packet end timestamps.
    end = Math.min(end, (last.pts + last.duration) / track.timescale + offsets[index]!);
  }
  if (end === Infinity) return document;
  return {
    ...document,
    ...(shortest ? { durationSeconds: end, duration: Math.round(end * document.timescale) } : {}),
    tracks: document.tracks.map((track, index) => {
      if (codecs[track.type] !== "copy") return shortest
        ? sliceMp4({ ...document, tracks: [track] }, { startSeconds: 0, endSeconds: end }).tracks[0]!
        : track;
      const samples = track.samples.slice(0, limits[index]).filter(sample =>
        (sample.pts + sample.duration) / track.timescale + offsets[index]! <= end + 1e-9);
      if (samples.length === track.samples.length) return track;
      const last = samples.at(-1);
      const duration = last ? last.dts + last.duration : 0;
      let remaining = Math.max(0, Math.round(((last ? (last.pts + last.duration) / track.timescale : 0) + offsets[index]!) * document.timescale));
      const editList = track.editList?.map(edit => {
        const segmentDuration = Math.min(edit.segmentDuration, remaining);
        remaining -= segmentDuration;
        return { ...edit, segmentDuration };
      });
      return { ...track, samples, duration, editList, decodedAudio: undefined, decodedVideoFrames: undefined };
    })
  };
}

function validateRawAudioCodec(doc: MediaDocument, plugin: MediaAstPlugin | undefined, codec: string | undefined): void {
  if (!plugin) return;
  const required = `pcm_${plugin.id}`;
  if (!plugin.supportedAudioCodecs.includes(required)) return;
  for (const track of doc.tracks) {
    if (track.type !== "audio") continue;
    const codecs = codec === "copy" ? track.codecDescriptions.map(description => description.codecName) : [codec ?? required];
    if (codecs.some(codec => codec !== required)) {
      throw new Error(`${plugin.id} muxer supports only codec ${required} for type audio`);
    }
  }
}

function validateStreamCopy(
  doc: MediaDocument,
  outputFormat: string,
  codecs: Partial<Record<MediaTrack["type"], string | undefined>>
): void {
  const requiredSubtitleCodec = outputFormat === "srt" ? "subrip" : outputFormat === "webvtt" ? "webvtt" : outputFormat === "ass" ? "ass" : outputFormat === "ttml" ? "ttml" : undefined;
  for (const track of doc.tracks) {
    if (codecs[track.type] !== "copy") continue;
    if (outputFormat === "avi" && track.samples.length && track.codecDescriptions.some(description => description.h264Framing === "avcc")) {
      throw new Error("h264 bitstream malformed, no startcode found; use -bsf:v h264_mp4toannexb");
    }
    const allowed = outputFormat === "webm"
      ? track.type === "video" ? ["vp8", "vp9", "av1"]
        : track.type === "audio" ? ["vorbis", "opus"]
          : track.type === "subtitle" ? ["webvtt"] : []
      : outputFormat === "flv" && track.type === "video" ? ["h264", "flv1"]
      : track.type === "subtitle" && requiredSubtitleCodec ? [requiredSubtitleCodec] : undefined;
    if (allowed === undefined) continue;
    for (const description of track.codecDescriptions) {
      if (!allowed.includes(description.codecName)) {
        throw new Error(`Cannot copy ${track.type} codec '${description.codecName}' to ${outputFormat}; use ${track.type} transcoding.`);
      }
    }
  }
}

function validateSubtitleEncoder(codec: string | undefined, doc: MediaDocument, outputFormat: string): void {
  if (codec === undefined || codec === "copy" || !doc.tracks.some(track => track.type === "subtitle")) return;
  const name = codec === "srt" ? "subrip" : codec;
  if (!["subrip", "webvtt", "mov_text", "ass", "ttml"].includes(name)) {
    throw new Error(`Unknown encoder '${codec}'`);
  }
  if (outputFormat === "mkv" && (name === "webvtt" || name === "subrip" || name === "ass")) return;
  // These serializers encode subtitles in a fixed format. Never silently
  // substitute that format for an explicitly requested encoder.
  const encodedCodec = outputFormat === "srt" || outputFormat === "mkv" ? "subrip"
    : outputFormat === "webvtt" || outputFormat === "webm" ? "webvtt"
    : outputFormat === "mp4" || outputFormat === "mov" ? "mov_text"
    : outputFormat === "ass" ? "ass" : outputFormat === "ttml" ? "ttml" : undefined;
  if (name !== encodedCodec) {
    throw new Error(`Subtitle encoder '${codec}' is not supported for ${outputFormat}`);
  }
}

function recodeSubtitles(doc: MediaDocument, charset: string): MediaDocument {
  const name = charset.toUpperCase();
  // WHATWG maps ASCII and ISO-8859-1 to Windows-1252; iconv does not.
  const ascii = ["ASCII", "US-ASCII", "ANSI_X3.4-1968"].includes(name);
  const latin1 = ["LATIN1", "LATIN-1", "ISO-8859-1", "ISO8859-1"].includes(name);
  return { ...doc, tracks: doc.tracks.map(track => {
    if (track.type !== "subtitle") return track;
    let decoder: TextDecoder;
    try { decoder = new TextDecoder(ascii || latin1 ? "utf-8" : charset, { fatal: true, ignoreBOM: true }); }
    catch { throw new Error(`Unable to open iconv context with input character encoding "${charset}"`); }
    const decodeErrors = [...(track.decodeErrors ?? [])];
    const samples = track.samples.flatMap(sample => {
      const codec = track.codecDescriptions[sample.sampleDescriptionIndex - 1]?.codecName;
      if (codec !== "subrip" && codec !== "webvtt") return [sample];
      let text: string;
      try {
        if (ascii && sample.data.some(byte => byte > 0x7f)) throw new Error("Invalid ASCII");
        text = latin1 ? Array.from(sample.data, byte => String.fromCharCode(byte)).join("") : decoder.decode(sample.data);
      } catch {
        decodeErrors.push(`Unable to recode subtitle event "${decodeUtf8(sample.data)}" from ${charset} to UTF-8`);
        return [];
      }
      const data = encodeUtf8(text);
      return [{ ...sample, data, size: data.byteLength }];
    });
    return { ...track, samples, decodeErrors };
  }) };
}

function fixSubtitleDurations(doc: MediaDocument): MediaDocument {
  const tracks = doc.tracks.map(track => {
    if (track.type !== "subtitle") return track;
    // Decoding buffers one event until the next arrives; EOF does not flush it.
    const samples = track.samples.slice(0, -1).flatMap((sample, index) => {
      const duration = Math.min(sample.duration, track.samples[index + 1]!.pts - sample.pts);
      return duration > 0 ? [{ ...sample, duration }] : [];
    });
    const duration = samples.reduce((end, sample) => Math.max(end, sample.pts + sample.duration), 0);
    return { ...track, samples, duration };
  });
  const durationSeconds = Math.max(0, ...tracks.map(track => track.duration / track.timescale));
  return { ...doc, tracks, durationSeconds, duration: Math.round(durationSeconds * doc.timescale) };
}

function validateSubtitleText(doc: MediaDocument, exitOnError: boolean): MediaDocument {
  return {
    ...doc,
    tracks: doc.tracks.map(track => {
      if (track.type !== "subtitle") return track;
      const decodeErrors = [...(track.decodeErrors ?? [])];
      const samples = track.samples.filter(sample => {
        if (exitOnError && decodeErrors.length > 0) return false;
        const codec = track.codecDescriptions[sample.sampleDescriptionIndex - 1]?.codecName;
        if (codec !== "subrip" && codec !== "webvtt") return true;
        try { new TextDecoder("utf-8", { fatal: true }).decode(sample.data); return true; }
        catch {
          decodeErrors.push("Invalid UTF-8 in decoded subtitles text");
          return false;
        }
      });
      return { ...track, samples, decodeErrors };
    })
  };
}

function transcodeSubtitles(doc: MediaDocument, outputFormat: string | undefined, subtitleCodec: string | undefined): MediaDocument {
  const containerCodec = outputFormat === "webm" ? "webvtt"
    : outputFormat === "mkv" ? subtitleCodec === "ass" ? "ass" : subtitleCodec === "webvtt" ? "webvtt" : "subrip" : undefined;
  return {
    ...doc,
    tracks: doc.tracks.map(track => {
      if (track.type !== "subtitle") return track;
      const samples = track.samples.map((sample, index) => {
        const description = track.codecDescriptions[sample.sampleDescriptionIndex - 1];
        const codec = description?.codecName;
        if (codec === "webvtt" || codec === "subrip") {
          // Subtitle markup is ASCII; scan bytes without repairing invalid UTF-8.
          const text = decodeLatin1(sample.data);
          const parts: string[] = [];
          const coordinates = sample.subtitlePosition;
          if (codec === "subrip" && (outputFormat === "ass" || containerCodec === "ass")
            && coordinates && coordinates.x1 >= 0 && coordinates.y1 >= 0) {
            const { x1, x2, y1, y2 } = coordinates;
            const centered = x2 >= x1 && y2 >= y1 && (x2 > x1 || y2 > y1);
            // FFmpeg maps SubRip's 720x480 coordinates to its 384x288 ASS canvas.
            const x = Math.trunc((centered ? Math.trunc((x1 + x2) / 2) : x1) * 384 / 720);
            const y = Math.trunc((centered ? Math.trunc((y1 + y2) / 2) : y1) * 288 / 480);
            parts.push(`{\\an${centered ? 5 : 1}}{\\pos(${x},${y})}`);
          }
          const styles: string[] = [];
          const fonts: number[] = [];
          const assFonts: Record<string, string>[] = [{}];
          const encodeAss = codec === "subrip" && (outputFormat === "ass" || containerCodec === "ass");
          const encodeSrt = codec === "subrip" && outputFormat === "srt";
          const webvtt = outputFormat === "webvtt" || containerCodec === "webvtt";
          let alignments = 0;
          let position = 0;
          while (position < text.length) {
            if (codec === "subrip" && (webvtt || encodeAss) && text.startsWith("{\\", position)) {
              const end = text.indexOf("}", position + 2);
              if (text.startsWith("{\\an", position) && end === position + 5
                && "0123456789".includes(text[position + 4]!)) alignments++;
              // Native SubRip retains overrides after its first alignment until
              // another alignment appears, and leaves unclosed ASS text literal.
              if (encodeAss && (alignments === 1 || end < 0)) parts.push(text.slice(position, end < 0 ? undefined : end + 1));
              position = end < 0 ? text.length : end + 1;
            } else if (codec === "subrip" && webvtt
              && (text.startsWith("{y:", position) || text.startsWith("{Y:", position))) {
              const end = text.indexOf("}", position + 3);
              if (end < 0) parts.push("{");
              position = end < 0 ? position + 1 : end + 1;
            } else if (codec === "subrip" && (webvtt || encodeSrt) && text[position] === "\\"
              && (text[position + 1] === "N" || text[position + 1] === "n")) {
              parts.push("\n");
              position += 2;
            } else if (codec === "webvtt" && text.startsWith("\\n", position)) {
              parts.push(outputFormat === "srt" || containerCodec === "subrip" ? "\r\n" : "\n");
              position += 2;
            } else if (text[position] === "<") {
              const end = text.indexOf(">", position + 1);
              if (end < 0) break;
              let tag = text.slice(position + 1, end);
              if (codec === "subrip" && ["B", "/B", "I", "/I", "U", "/U"].includes(tag)) tag = tag.toLowerCase();
              if (codec === "subrip" && (webvtt || outputFormat === "ass" || containerCodec === "ass")
                && ["br", "br/", "br /"].includes(tag.toLowerCase())) {
                parts.push("\n");
              } else if (["b", "i", "u"].includes(tag)) {
                styles.push(tag);
                parts.push(codec === "webvtt" && containerCodec === "ass" ? `{\\${tag}1}` : `<${tag}>`);
              } else if (["/b", "/i", "/u"].includes(tag)) {
                const open = styles.lastIndexOf(tag.slice(1));
                if (open >= 0) {
                  while (styles.length > open) {
                    const style = styles.pop()!;
                    parts.push(codec === "webvtt" && containerCodec === "ass" ? `{\\${style}0}` : `</${style}>`);
                  }
                }
              } else if (encodeSrt && ["s", "/s"].includes(tag)) {
                parts.push(`<${tag}>`);
              } else if (codec === "subrip" && !(encodeAss && (tag.startsWith("font ") || tag === "font" || tag === "/font"))
                && ((!webvtt && !encodeSrt && !encodeAss) || Array.from(tag.split(" ", 1)[0]!).some(char =>
                !(char >= "0" && char <= "9" || char >= "a" && char <= "z"
                  || char >= "A" && char <= "Z" || char === "_" || char === "/")))) {
                // SubRip timestamp-like text is literal, unlike WebVTT timestamp tags.
                parts.push(`<${tag}>`);
              }
              if ((encodeSrt || encodeAss) && (tag.startsWith("font ") || tag === "font")) {
                const assFont = { ...assFonts[assFonts.length - 1]! };
                let attributes = tag.slice(5).trimStart();
                let count = 0;
                while (attributes) {
                  const equals = attributes.indexOf("=");
                  if (equals < 0) break;
                  const name = attributes.slice(0, equals).trim();
                  attributes = attributes.slice(equals + 1).trimStart();
                  const quoted = attributes.startsWith('"');
                  if (quoted) attributes = attributes.slice(1);
                  let end = quoted ? attributes.indexOf('"') : attributes.indexOf(" ");
                  if (end < 0) end = attributes.length;
                  let value = attributes.slice(0, end);
                  attributes = attributes.slice(end + 1).trimStart();
                  if (!["face", "size", "color"].includes(name)) continue;
                  if (name === "color") {
                    try {
                      const [red, green, blue] = parseColorRgba(value);
                      value = encodeAss ? "&H" + (red | green << 8 | blue << 16).toString(16).toUpperCase() + "&"
                        : "#" + [red, green, blue].map(channel => channel.toString(16).padStart(2, "0")).join("");
                    } catch { continue; }
                  }
                  if (name === "size" && !(Number(value) > 0)) continue;
                  if (encodeAss) {
                    const property = name === "face" ? "fn" : name === "size" ? "fs" : "c";
                    assFont[property] = value;
                    parts.push(`{\\${property}${value}}`);
                  } else {
                    parts.push(`<font ${name}="${value}">`);
                    count++;
                  }
                }
                if (encodeAss) assFonts.push(assFont);
                else fonts.push(count);
              } else if (encodeAss && tag === "/font" && assFonts.length > 1) {
                const current = assFonts.pop()!;
                const parent = assFonts[assFonts.length - 1]!;
                for (const property of ["fs", "c", "fn"]) {
                  if (current[property] !== parent[property]) parts.push(`{\\${property}${parent[property] ?? ""}}`);
                }
              } else if (encodeSrt && tag === "/font") {
                parts.push("</font>".repeat(fonts.pop() ?? 0));
              }
              position = end + 1;
            } else if (codec === "webvtt" && text[position] === "&") {
              const reference = ([
                ["&amp;", "&"], ["&lt;", "<"], ["&gt;", ">"],
                ["&nbsp;", "\\h"], ["&lrm;", ""], ["&rlm;", ""]
              ] as const).find(([name]) => text.startsWith(name, position));
              parts.push(reference ? reference[1] : "&");
              position += reference ? reference[0].length : 1;
            } else {
              if (codec === "webvtt" && (text[position] === "{" || text[position] === "}")) parts.push("\\");
              parts.push(text[position]!);
              // SubRip strips ASCII indentation after physical line breaks only.
              if (codec === "subrip" && webvtt && text[position] === "\n") {
                while (text[position + 1] === " ") position++;
              }
              position++;
            }
          }
          parts.push(text.slice(position));
          while (fonts.length) parts.push("</font>".repeat(fonts.pop()!));
          while (styles.length > 0) {
            const style = styles.pop()!;
            parts.push(codec === "webvtt" && containerCodec === "ass" ? `{\\${style}0}` : `</${style}>`);
          }
          const data = Uint8Array.from(parts.join(""), char => char.charCodeAt(0));
          sample = { ...sample, data, size: data.byteLength, webvtt: undefined };
        }
        if (containerCodec === "ass") {
          // Matroska ASS packets omit timestamps and include a read-order prefix.
          if (codec === "ass" && description?.extraData) return sample;
          let text = decodeUtf8(sample.data).replaceAll("\r\n", "\n").replaceAll("\n", "\\N");
          for (const tag of codec === "webvtt" ? [] : ["i", "b", "u", "s"]) {
            text = text.replaceAll(`<${tag}>`, `{\\${tag}1}`).replaceAll(`</${tag}>`, `{\\${tag}0}`);
          }
          const data = encodeUtf8(`${index},0,Default,,0,0,0,,${text}`);
          return { ...sample, data, size: data.byteLength, webvtt: undefined };
        }
        if (codec === "ass" && (doc.containerFormat === "matroska" || doc.containerFormat === "webm")) {
          const data = encodeUtf8(decodeMatroskaAss(decodeUtf8(sample.data)));
          return { ...sample, data, size: data.byteLength, webvtt: undefined };
        }
        if (codec === "jacosub") {
          let text = decodeUtf8(sample.data);
          const separator = text.indexOf(" ");
          const directive = text.slice(0, separator).toUpperCase();
          if (separator >= 0 && ["JL", "JR", "JC"].includes(directive)) {
            text = (directive === "JL" ? "{\\an1}" : directive === "JR" ? "{\\an3}" : "{\\an2}") + text.slice(separator + 1);
          }
          const data = encodeUtf8(text.replaceAll("\\n", "\n"));
          return { ...sample, data, size: data.byteLength };
        }
        if (codec === "microdvd" || codec === "mpl2") {
          const data = encodeUtf8(decodeUtf8(sample.data).replaceAll("|", "\n"));
          return { ...sample, data, size: data.byteLength };
        }
        return { ...sample, webvtt: undefined };
      });
      return { ...track, samples,
        codecDescriptions: containerCodec ? track.codecDescriptions.map(description => ({
          ...description, codecName: containerCodec,
          formatFourCC: containerCodec === "ass" ? "ass " : containerCodec === "webvtt" ? "wvtt" : "tx3g",
          extraData: containerCodec === "ass"
            ? description.codecName === "ass" && description.extraData ? description.extraData : assAst().serialize({ ...doc, tracks: [] })
            : undefined
        })) : track.codecDescriptions
      };
    })
  };
}

function parseDisplayAspect(option: string, value: string | undefined): [string, number] {
  const specifier = option === "-aspect" ? "" : option.slice("-aspect:".length);
  const parts = specifier.split(":");
  if (["v", "a", "s", "d", "t"].includes(parts[0]!)) parts.shift();
  if (parts.length > 1 || (parts[0] && !Array.from(parts[0]).every(char => char >= "0" && char <= "9"))) {
    throw new Error(`Invalid -aspect stream specifier: ${specifier}`);
  }
  const ratio = value?.split(":") ?? [];
  const aspect = ratio.length === 2 ? Number(ratio[0]) / Number(ratio[1]) : Number(value);
  if (ratio.length > 2 || !Number.isFinite(aspect) || aspect <= 0) throw new Error("Invalid -aspect value");
  return [specifier, aspect];
}

function applyDisplayAspects(doc: MediaDocument, aspects: readonly [string, number][]): MediaDocument {
  if (!aspects.length) return doc;
  let videoIndex = 0;
  return { ...doc, tracks: doc.tracks.map((track, trackIndex) => {
    if (track.type !== "video") return track;
    const ordinal = videoIndex++;
    let aspect: number | undefined;
    for (const [specifier, value] of aspects) {
      const [selector, index] = specifier.split(":");
      if (selector === "v" ? index && Number(index) !== ordinal : selector && Number(selector) !== trackIndex) continue;
      aspect = value;
    }
    if (aspect === undefined) return track;
    const codec = track.codecDescriptions[0];
    const ratio = aspect * (codec?.height ?? track.height)! / (codec?.width ?? track.width)!;
    // Continued fractions retain simple ratios for decimal spellings such as 1.7777778.
    let remainder = ratio;
    let numerator = 1, denominator = 0, previousNumerator = 0, previousDenominator = 1;
    for (let step = 0; step < 32; step++) {
      const whole = Math.floor(remainder);
      const nextNumerator = whole * numerator + previousNumerator;
      const nextDenominator = whole * denominator + previousDenominator;
      if (nextNumerator > 65535 || nextDenominator > 65535) break;
      [previousNumerator, numerator] = [numerator, nextNumerator];
      [previousDenominator, denominator] = [denominator, nextDenominator];
      if (Math.abs(numerator / denominator - ratio) < 1e-7) break;
      remainder = 1 / (remainder - whole);
    }
    if (!numerator || !denominator) throw new Error("Invalid -aspect value for video dimensions");
    return { ...track, codecDescriptions: track.codecDescriptions.map(codec => ({ ...codec, sarWidth: numerator, sarHeight: denominator })) };
  }) };
}

type DisplayTransform = [specifier: string, option: string, value: number];

function parseDisplayTransform(option: string, value: string | undefined): DisplayTransform {
  const separator = option.indexOf(":");
  const name = separator < 0 ? option : option.slice(0, separator);
  const specifier = separator < 0 ? "" : option.slice(separator + 1);
  const parts = specifier.split(":");
  if (["v", "a", "s", "d", "t"].includes(parts[0]!)) parts.shift();
  if (parts.length > 1 || (parts[0] && !Array.from(parts[0]).every(char => char >= "0" && char <= "9"))) {
    throw new Error(`Invalid ${name} stream specifier: ${specifier}`);
  }
  const rotation = name === "-display_rotation" ? (value?.trim() ? Number(value) : NaN) : 0;
  if (!Number.isFinite(rotation)) throw new Error(`Invalid ${name} value`);
  return [specifier, name, -rotation];
}

function applyInputDisplayTransforms(doc: MediaDocument, transforms: readonly DisplayTransform[]): MediaDocument {
  if (!transforms.length) return doc;
  let videoIndex = 0;
  return { ...doc, tracks: doc.tracks.map((track, trackIndex) => {
    if (track.type !== "video") return track;
    const ordinal = videoIndex++;
    let angle: number | undefined;
    let horizontal = false;
    let vertical = false;
    for (const [specifier, option, value] of transforms) {
      const [selector, index] = specifier.split(":");
      if (selector === "v" ? index && Number(index) !== ordinal : selector && Number(selector) !== trackIndex) continue;
      if (option === "-display_rotation") angle = value;
      else if (option === "-display_hflip") horizontal = true;
      else vertical = true;
    }
    if (angle === undefined && !horizontal && !vertical) return track;
    const matrix = matrixForRotation(angle ?? 0).map((value, index) =>
      value * ((index % 3 === 0 && horizontal) || (index % 3 === 1 && vertical) ? -1 : 1) || 0);
    return { ...track, rotation: undefined, matrix };
  }) };
}

function parseAudioChannels(option: string, value: string | undefined): [string, number | undefined] {
  const specifier = option === "-ac" ? "" : option.slice("-ac:".length);
  const parts = specifier.split(":");
  if (["v", "a", "s", "d", "t"].includes(parts[0]!)) parts.shift();
  if (parts.length > 1 || (parts[0] && !Array.from(parts[0]).every(char => char >= "0" && char <= "9"))) {
    throw new Error(`Invalid -ac stream specifier: ${specifier}`);
  }
  const text = value?.trimStart();
  const unsigned = text?.startsWith("+") || text?.startsWith("-") ? text.slice(1) : text;
  const channels = unsigned?.toLowerCase().startsWith("0x")
    ? Number(unsigned) * (text!.startsWith("-") ? -1 : 1) : Number(text);
  if (text === undefined || text !== text.trimEnd() || value !== "" && !text ||
      unsigned?.toLowerCase().startsWith("0b") || unsigned?.toLowerCase().startsWith("0o") ||
      !Number.isInteger(channels) || channels < -2147483648 || channels > 2147483647) {
    throw new Error("Invalid -ac channel count: expected a whole 32-bit integer");
  }
  return [specifier, channels];
}

function audioChannelsForStream(options: readonly [string, number | undefined][], trackIndex: number, audioIndex: number): number | undefined {
  let channels: number | undefined;
  for (const [specifier, value] of options) {
    const [selector, index] = specifier.split(":");
    if (selector === "a" ? index && Number(index) !== audioIndex : selector && Number(selector) !== trackIndex) continue;
    channels = value;
  }
  return channels;
}

function parseTimestampScale(option: string, value: string | undefined): [string, number] {
  const specifier = option === "-itsscale" ? "" : option.slice("-itsscale:".length);
  const parts = specifier.split(":");
  if (["v", "a", "s"].includes(parts[0]!)) parts.shift();
  if (parts.length > 1 || (parts[0] && !Array.from(parts[0]).every(char => char >= "0" && char <= "9"))) {
    throw new Error(`Invalid -itsscale stream specifier: ${specifier}`);
  }
  const scale = value?.trim() ? Number(value) : NaN;
  if (!Number.isFinite(scale)) throw new Error("Invalid -itsscale value");
  return [specifier, scale];
}

function inputStartTime(doc: MediaDocument, budget: MediaBudgetTracker, outputFormat: string | undefined): number | undefined {
  // MP4 retains Matroska's packet spacing but starts its presentation at zero,
  // unless -copyts requests the original timeline (including codec delay).
  const matroskaToMp4 = (doc.containerFormat === "matroska" || doc.containerFormat === "webm") &&
    (outputFormat === "mp4" || outputFormat === "mov");
  if (doc.containerFormat !== "mp4" && doc.containerFormat !== "mov" && !matroskaToMp4) return undefined;
  let start = Infinity;
  for (const track of doc.tracks) {
    budget.checkCpu();
    if (!track.samples.length) continue;
    let seconds = track.samples[0]!.pts / track.timescale;
    if (track.editList?.length) {
      // The presentation starts after empty edits; media edits can retain
      // negative priming packets, which must not become the input origin.
      seconds = 0;
      for (const edit of track.editList) {
        if (edit.mediaTime >= 0) break;
        seconds += edit.segmentDuration / doc.timescale;
      }
    }
    start = Math.min(start, seconds);
  }
  return Number.isFinite(start) ? start : undefined;
}

function synchronizeInputs(docs: MediaDocument[], inputs: InputSpec[], starts: (number | undefined)[], copyTimestamps: boolean, startAtZero: boolean, budget: MediaBudgetTracker): void {
  for (const [index, input] of inputs.entries()) {
    const reference = input.syncReference;
    if (reference === undefined || reference === -1 || reference === index) continue;
    if (reference >= inputs.length) throw new Error("Invalid -isync reference input");
    if (copyTimestamps && !startAtZero) throw new Error("-isync with -copyts requires -start_at_zero");
    const target = inputs[reference]!;
    if (target.syncReference !== undefined && target.syncReference !== -1 && target.syncReference !== reference) continue;
    const start = starts[index];
    const referenceStart = starts[reference];
    if (start === undefined || referenceStart === undefined) continue;
    const adjustment = start - referenceStart + (target.timestampOffset ?? 0) +
      (copyTimestamps ? 0 : (input.startSeconds ?? 0) - (target.startSeconds ?? 0));
    docs[index] = shiftTimestamps(docs[index]!, adjustment, budget);
  }
}

function scaleInputTimestamps(doc: MediaDocument, scales: readonly [string, number][], budget: MediaBudgetTracker): MediaDocument {
  if (!scales.length) return doc;
  const tracks = doc.tracks.map((track, trackIndex) => {
    let scale = 1;
    for (const [specifier, value] of scales) {
      const [selector, ordinal] = specifier.split(":");
      const type = selector === "v" ? "video" : selector === "a" ? "audio" : selector === "s" ? "subtitle" : undefined;
      const index = type ? ordinal : selector;
      if (type && type !== track.type) continue;
      const current = type ? doc.tracks.slice(0, trackIndex).filter(candidate => candidate.type === type).length : trackIndex;
      if (index && current !== Number(index)) continue;
      scale = value;
    }
    if (scale === 1) return track;
    let duration = 0;
    const samples = track.samples.map(sample => {
      budget.checkCpu();
      const pts = Math.trunc(sample.pts * scale);
      const dts = Math.trunc(sample.dts * scale);
      if (!Number.isSafeInteger(pts) || !Number.isSafeInteger(dts)) throw new Error("Invalid -itsscale timestamp");
      duration = Math.max(duration, pts + sample.duration);
      return { ...sample, pts, dts, cts: pts - dts };
    });
    const decodedVideoFrames = track.decodedVideoFrames?.map(frame => {
      budget.checkCpu();
      const ptsSeconds = Math.trunc(frame.ptsSeconds * track.timescale * scale) / track.timescale;
      duration = Math.max(duration, Math.round((ptsSeconds + frame.durationSeconds) * track.timescale));
      return { ...frame, ptsSeconds };
    });
    const editList = track.editList?.map(edit => {
      const mediaTime = edit.mediaTime < 0 ? -1 : Math.trunc(edit.mediaTime * scale);
      return { ...edit, mediaTime, segmentDuration: edit.mediaTime < 0
        ? Math.trunc(edit.segmentDuration * scale)
        : Math.round(Math.max(0, duration - mediaTime) * doc.timescale / track.timescale) };
    });
    return { ...track, samples, duration, editList, ...(decodedVideoFrames ? { decodedVideoFrames } : {}) };
  });
  const durationSeconds = Math.max(0, ...tracks.map(track => track.duration / track.timescale));
  budget.checkDuration(durationSeconds);
  return { ...doc, tracks, durationSeconds, duration: Math.round(durationSeconds * doc.timescale) };
}

function imageOutputFormat(codec: string | undefined, extension: string): ImageFormat | "tga" {
  const format = codec && codec !== "copy" ? codec : extension;
  switch (format) {
    case "mjpeg": case "jpg": case "jpeg": return "jpeg";
    case "libwebp": case "libwebp_anim": case "webp": return "webp";
    case "targa": case "tga": return "tga";
    case "qoi": case "gif": case "bmp": case "ppm": return format;
    default: return "png";
  }
}

const imageEncoders = ["png", "mjpeg", "webp", "libwebp", "libwebp_anim", "gif", "bmp", "ppm", "qoi", "targa"];

function validateAudioEncoder(codec: string | undefined, doc: MediaDocument, plugins: readonly MediaAstPlugin[]): void {
  if (codec === undefined || codec === "copy" || !doc.tracks.some(track => track.type === "audio")) return;
  const name = codec === "libvo_amrwbenc" ? "amr_wb" : codec === "libopencore_amrnb" ? "amr_nb" : codec === "libopus" ? "opus" : codec === "libvorbis" ? "vorbis" : codec === "libmp3lame" ? "mp3" : codec;
  if (!plugins.some(plugin => plugin.canMux && plugin.supportedAudioCodecs.includes(name))) {
    throw new Error(`Unknown encoder '${codec}'`);
  }
}

function shiftTimestamps(doc: MediaDocument, seconds: number, budget: MediaBudgetTracker): MediaDocument {
  if (seconds === 0) return doc;
  const durationSeconds = Math.max(0, doc.durationSeconds + seconds);
  budget.checkDuration(durationSeconds);
  return { ...doc, durationSeconds, duration: Math.round(durationSeconds * doc.timescale),
    tracks: doc.tracks.map(track => {
      budget.checkCpu();
      const shift = Math.round(seconds * track.timescale);
      const duration = Math.max(0, track.duration + shift);
      if (track.editList?.length) {
        // Move the presentation timeline, retaining compressed priming packets.
        const firstMedia = track.editList.findIndex(edit => edit.mediaTime >= 0);
        if (firstMedia >= 0) {
          const edit = track.editList[firstMedia]!;
          const delay = track.editList.slice(0, firstMedia).reduce((sum, entry) => sum + entry.segmentDuration, 0);
          // Video composition delay remains an edit; audio priming becomes
          // ordinary packets when a positive offset moves it after time zero.
          const origin = track.type === "video" ? edit.mediaTime : 0;
          const start = delay / doc.timescale - (edit.mediaTime - origin) / track.timescale + seconds;
          const mediaTime = origin + Math.max(0, Math.round(-start * track.timescale));
          const emptyDuration = Math.max(0, Math.floor(start * doc.timescale));
          return { ...track, duration, editList: [
            ...(emptyDuration ? [{ ...edit, segmentDuration: emptyDuration, mediaTime: -1 }] : []),
            { ...edit, mediaTime, segmentDuration: Math.max(0, edit.segmentDuration + Math.round((edit.mediaTime - mediaTime) * doc.timescale / track.timescale)) },
            ...track.editList.slice(firstMedia + 1)
          ] };
        }
      }
      return { ...track, duration,
        samples: track.samples.map(sample => {
          budget.checkCpu();
          return { ...sample, pts: sample.pts + shift, dts: sample.dts + shift };
        }),
        ...(track.decodedVideoFrames ? { decodedVideoFrames: track.decodedVideoFrames.map(frame => ({ ...frame, ptsSeconds: frame.ptsSeconds + seconds })) } : {})
      };
    })
  };
}

function avoidNegativeTimestamps(doc: MediaDocument, mode: string, budget: MediaBudgetTracker): MediaDocument {
  if (mode !== "make_non_negative" && mode !== "make_zero") return doc;
  let first = Infinity;
  for (const track of doc.tracks) {
    budget.checkCpu();
    if (!track.samples.length) continue;
    let offset = 0;
    for (const edit of track.editList ?? []) {
      if (edit.mediaTime < 0) offset += edit.segmentDuration / doc.timescale;
      else { offset -= edit.mediaTime / track.timescale; break; }
    }
    first = Math.min(first, track.samples[0]!.dts / track.timescale + offset);
  }
  return Number.isFinite(first) && (first < 0 || mode === "make_zero")
    ? shiftTimestamps(doc, -first, budget) : doc;
}

function applyVideoTag(doc: MediaDocument, format: string, codec: string | undefined, tag: string | undefined): MediaDocument {
  if (tag === undefined || codec !== "copy" || (format !== "mp4" && format !== "mov")) return doc;
  const codecs: Record<string, string> = {
    avc1: "h264", avc3: "h264", hvc1: "hevc", hev1: "hevc", av01: "av1",
    vp09: "vp9", mp4v: "mpeg4", jpeg: "mjpeg", "png ": "png"
  };
  return { ...doc, tracks: doc.tracks.map(track => track.type !== "video" ? track : {
    ...track,
    codecDescriptions: track.codecDescriptions.map(description => {
      if (!Object.hasOwn(codecs, tag) || codecs[tag] !== description.codecName) {
        throw new Error(`Tag ${tag} incompatible with output codec ${description.codecName}`);
      }
      const rawStsdEntryBytes = description.rawStsdEntryBytes && Uint8Array.from(description.rawStsdEntryBytes);
      if (rawStsdEntryBytes) {
        for (let i = 0; i < 4; i++) rawStsdEntryBytes[4 + i] = tag.charCodeAt(i);
      }
      return { ...description, formatFourCC: tag, rawStsdEntryBytes };
    })
  }) };
}

function rescaleMovie(doc: MediaDocument, timescale: number): MediaDocument {
  const scale = timescale / doc.timescale;
  return { ...doc, timescale, duration: Math.round(doc.duration * scale),
    tracks: doc.tracks.map(track => ({ ...track,
      editList: track.editList?.map(edit => ({ ...edit, segmentDuration: Math.round(edit.segmentDuration * scale) }))
    })) };
}

function rescaleVideoTracks(doc: MediaDocument, timescale: number, budget: MediaBudgetTracker): MediaDocument {
  return { ...doc, tracks: doc.tracks.map(track => {
    if (track.type !== "video" || track.timescale === timescale) return track;
    const scale = timescale / track.timescale;
    return { ...track, timescale, duration: Math.round(track.duration * scale),
      samples: track.samples.map(sample => {
        budget.checkCpu();
        const dts = Math.round(sample.dts * scale);
        const pts = Math.round(sample.pts * scale);
        return { ...sample, dts, pts, cts: pts - dts,
          duration: Math.round((sample.dts + sample.duration) * scale) - dts };
      }),
      editList: track.editList?.map(edit => ({ ...edit,
        mediaTime: edit.mediaTime < 0 ? edit.mediaTime : Math.round(edit.mediaTime * scale) }))
    };
  }) };
}

function validateMovflags(value: string): void {
  const flags = value.split("-").join("+").split("+").filter(Boolean);
  if (flags.length === 0) throw new Error("Invalid movflags: expected a flag name");
  for (const flag of flags) {
    if (!["disable_chpl", "use_metadata_tags", "faststart", "frag_keyframe", "frag_every_frame", "empty_moov", "default_base_moof", "write_colr", "skip_trailer", "global_sidx", "dash"].includes(flag)) {
      throw new Error(`Unsupported movflags: ${flag}`);
    }
  }
}

function parseMpegtsTablesVersion(value: string): number {
  const version = Number(value);
  if (!value.trim() || !Number.isInteger(version) || version < 0 || version > 31) {
    throw new Error("Invalid -tables_version: expected an integer from 0 through 31");
  }
  return version;
}

function parseMpegtsServiceType(value: string): number {
  const type = value === "digital_radio" ? 2 : value === "digital_tv" ? 1 : Number(value);
  if (!Number.isInteger(type) || type < 1 || type > 255) {
    throw new Error("Invalid -mpegts_service_type: expected digital_tv, digital_radio, or an integer from 1 through 255");
  }
  return type;
}

function parseMpegtsFlags(value: string, current: number): number {
  let enabled = value.startsWith("+") || value.startsWith("-") ? current : 0;
  if (!value) throw new Error("Missing -mpegts_flags value");
  let position = 0;
  while (position < value.length) {
    const remove = value[position] === "-";
    if (remove || value[position] === "+") position++;
    const start = position;
    while (position < value.length && value[position] !== "+" && value[position] !== "-") position++;
    const flag = value.slice(start, position);
    const bits = flag === "pat_pmt_at_frames" ? 16 : flag === "initial_discontinuity" ? 32 : flag === "latm" ? 8 : flag === "omit_rai" ? 64 : Number(flag);
    if (!flag || !Number.isInteger(bits) || bits < 0 || bits > 120 || (bits & ~120) !== 0) {
      throw new Error(`Unsupported -mpegts_flags value: ${flag}`);
    }
    enabled = remove ? enabled & ~bits : enabled | bits;
  }
  return enabled;
}

function validateBitstreamFilters(value: string | undefined): void {
  if (!value) throw new Error("Missing bitstream filter chain");
  for (const filter of value.split(",")) {
    if (filter.trim() !== "null") {
      throw new Error(`Unsupported bitstream filter: ${filter || "(empty)"}; only null is supported`);
    }
  }
}

export function evalSyncFfmpeg(
  inBytesOrArgs: Uint8Array | readonly string[] | undefined,
  maybeArgs?: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  const inBytes = Array.isArray(inBytesOrArgs) ? undefined : (inBytesOrArgs as Uint8Array | undefined);
  const args = (Array.isArray(inBytesOrArgs) ? inBytesOrArgs : (maybeArgs ?? [])) as readonly string[];
  if (args.length === 0) return undefined;
  const { astPlugins, registry } = getDefaultMediaRegistry();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (
      arg === "-version" ||
      arg === "--version" ||
      arg === "-h" ||
      arg === "-help" ||
      arg === "--help" ||
      arg === "-formats" ||
      arg === "-demuxers" ||
      arg === "-muxers" ||
      arg === "-codecs" ||
      arg === "-decoders" ||
      arg === "-encoders" ||
      arg === "-protocols" ||
      arg === "-filters"
    ) {
      return formatIntrospectionOutput(arg, astPlugins);
    }
  }
  try {
    const budget = new MediaBudgetTracker();
    const inputs: InputSpec[] = [];
    let pendingFormat: string | undefined;
    let pendingAudioDecoder: string | undefined;
    let pendingTimestampOffset = 0;
    let pendingSyncReference: number | undefined;
    let copyInitialNonKeyframes = false;
    let copyPriorStart = true;
    let copyTimestamps = false;
    let startAtZero = false;
    let pendingSubtitleFrameRate: number | undefined;
    let pendingSubtitleCharencMode: string | undefined;
    let pendingSubtitleCharset: string | undefined;
    let pendingWebvttKind: string | undefined;
    let pendingFixSubDuration = false;
    let pendingSkipInitialBytes = 0;
    let pendingIgnoreLength = false;
    let pendingMaxSize: number | undefined;
    let pendingSs: number | undefined;
    let pendingTimestampScales: [string, number][] = [];
    let pendingDisplayTransforms: DisplayTransform[] = [];
    let pendingSseof: number | undefined;
    let pendingTo: number | undefined;
    let pendingDuration: number | undefined;
    let pendingLoop: number | undefined;
    let pendingFps: number | undefined;
    let pendingStartNumber: number | undefined;
    let outputStartNumber: number | undefined;
    let outputFormat: string | undefined;
    let outputTimestampOffset = 0;
    let muxDelay: number | undefined;
    let avoidNegativeTs = "auto";
    let outputSs: number | undefined;
    let outputTo: number | undefined;
    let outputDuration: number | undefined;
    let videoTag: string | undefined;
    let videoBitstreamFilter: string | undefined;
    let audioBitstreamFilter: string | undefined;
    let subtitleBitstreamFilter: string | undefined;
    let videoCodec: string | undefined;
    let maxBFrames: number | undefined;
    let audioCodec: string | undefined;
    let audioBitrate: number | undefined;
    let subtitleCodec: string | undefined;
    let audioRate: number | undefined;
    let audioChannelOptions: [string, number | undefined][] = [];
    let stripAudio = false;
    let stripVideo = false;
    let stripSubtitles = false;
    let shortest = false;
    let writeHeader = true;
    let writeXing = true;
    let writeBext = false;
    let patPeriod: number | undefined;
    let muxRate: number | undefined;
    let pcrPeriod: number | undefined;
    let writeCrc32 = true;
    let live = false;
    let writeTmcd = true;
    let sampleFormat: string | undefined;
    let trellis: number | undefined;
    let blockSize: number | undefined;
    let frameSize: number | undefined;
    let channelMode: string | undefined;
    let lpcType: string | undefined;
    let lpcPasses: number | undefined;
    let lpcCoeffPrecision: number | undefined;
    let minPartitionOrder: number | undefined;
    let maxPartitionOrder: number | undefined;
    let exactRiceParameters: number | undefined;
    let minPredictionOrder: number | undefined;
    let maxPredictionOrder: number | undefined;
    let predictionOrderMethod: string | undefined;
    let multiDimQuant: number | undefined;
    let compressionLevel: number | undefined;
    let peakBlockSize: number | undefined;
    let peakFormat: number | undefined;
    let peakPpv: number | undefined;
    let writePeak: "off" | "on" | "only" | undefined;
    let rf64: "always" | "auto" | "never" | undefined;
    let writeColr = false;
    let useMetadataTags = false;
    let disableChpl = false;
    let faststart = false;
    let majorBrand: string | undefined;
    let movieTimescale: number | undefined;
    let videoTrackTimescale = 0;
    let skipTrailer = false;
    let defaultBaseMoof = false;
    let segmentIndex: "global" | "fragment" | undefined;
    let mpegtsFlags = 0;
    let mpegtsTablesVersion: number | undefined;
    let omitVideoPesLength = true;
    let mpegtsServiceType: number | undefined;
    let fragmented = false;
    let fragmentKeyframes = false;
    let fragmentEveryFrame = false;
    let fragmentDuration: number | undefined;
    let fragmentIndex: number | undefined;
    let emptyMoov = false;
    let writeApetag: boolean | undefined;
    let writeId3v2: boolean | undefined;
    let mpegtsStartPid: number | undefined;
    let pesPayloadSize: number | undefined;
    let writeMpeg2: boolean | undefined;
    let id3v2Version: 0 | 3 | 4 | undefined;
    let writeId3v1: boolean | undefined;
    let metadataHeaderPadding: number | undefined;
    let reserveIndexSpace: number | undefined;
    let cuesToFront: boolean | undefined;
    let clusterTimeLimit: number | undefined;
    let pageDuration: number | undefined;
    let apngPlays = 1;
    let finalDelay: number | undefined;
    let rle: boolean | undefined;
    let globalPalette: boolean | undefined;
    let mpegtsServiceId: number | undefined;
    let serialOffset: number | undefined;
    let bitexact = false;
    let autobsf = true;
    let maxVideoFrames: number | undefined;
    let maxAudioFrames: number | undefined;
    let fileSize: number | undefined;
    let maxSubtitleFrames: number | undefined;
    const frameLimits: [string, number][] = [];
    let outputFps: number | undefined;
    let outputSize: string | undefined;
    let noOverwrite: boolean | undefined;
    const vfFilters: string[] = [];
    let chapterSource: number | undefined;
    const metadataSources: number[] = [];
    const streamMetadataMaps: [string, string][] = [];
    const metadata: Record<string, string> = {};
    const streamMetadata: [string, "language" | "handlerName" | "timecode" | "title" | "comment" | "stereo_mode", string][] = [];
    const streamDispositions: [string, string][] = [];
    let defaultMode = "passthrough";
    const displayAspects: [string, number][] = [];
    const outputColors: OutputColorOption[] = [];
    let outputTarget: string | undefined;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === "-y" || arg === "-n") {
        if (noOverwrite !== undefined && noOverwrite !== (arg === "-n")) return undefined;
        noOverwrite = arg === "-n";
      }
      else if (arg === "-bsf:a") {
        audioBitstreamFilter = args[++i];
        filterBitstream([], audioBitstreamFilter ?? "", budget, "audio");
      }
      else if (arg === "-bsf:s") {
        subtitleBitstreamFilter = args[++i];
        filterBitstream([], subtitleBitstreamFilter ?? "", budget, "subtitle");
      }
      else if (arg === "-tag:v") {
        videoTag = args[++i];
        if (videoTag === undefined) return undefined;
      }
      else if (arg === "-bsf:v") {
        videoBitstreamFilter = args[++i];
        filterBitstream([], videoBitstreamFilter ?? "", budget);
      }
      else if (arg === "-bsf" || arg.startsWith("-bsf:")) {
        validateBitstreamFilters(args[++i]);
      }
      else if (arg === "-vsync" || arg === "-fps_mode" || arg.startsWith("-fps_mode:")) return undefined;
      else if (arg === "-crf") return undefined;
      else if (arg === "-v" || arg === "-loglevel" || arg === "-safe" || arg === "-threads" || arg === "-pix_fmt" || arg === "-tag:a") i++;
      else if (arg === "-bf") {
        const value = args[++i];
        maxBFrames = value?.trim() ? Number(value) : NaN;
        if (!Number.isInteger(maxBFrames) || maxBFrames < -1 || maxBFrames > 2147483647) return undefined;
      }
      else if (arg === "-b:v") return undefined;
      else if (arg === "-b:a") {
        audioBitrate = parseBitrate(args[++i]);
        if (audioBitrate === undefined) return undefined;
      }
      else if (arg === "-map_chapters") {
        const value = args[++i];
        chapterSource = value?.trim() ? Number(value) : NaN;
        if (!Number.isSafeInteger(chapterSource)) return undefined;
      } else if (arg === "-map_metadata:s" || arg.startsWith("-map_metadata:s:")) {
        streamMetadataMaps.push([arg.slice("-map_metadata:s:".length), args[++i] ?? ""]);
      } else if (arg === "-map_metadata" || arg === "-map_metadata:g") {
        const source = args[++i];
        const value = source?.endsWith(":g") ? source.slice(0, -2) : source;
        const metadataSource = value?.trim() ? Number(value) : NaN;
        if (!Number.isSafeInteger(metadataSource)) return undefined;
        metadataSources.push(metadataSource);
      } else if (arg === "-start_number") {
        const val = Number(args[++i]);
        if (!Number.isSafeInteger(val) || val < 0) return undefined;
        if (args.slice(i + 1).includes("-i")) pendingStartNumber = val;
        else outputStartNumber = val;
      } else if (arg === "-ar" || (arg === "-sample_rate" && args.slice(i + 1).includes("-i"))) {
        audioRate = parseInt(args[++i] ?? "0", 10) || undefined;
        if (audioRate !== undefined && audioRate < 0) return undefined;
      }
      else if (arg === "-ac" || arg.startsWith("-ac:")) audioChannelOptions.push(parseAudioChannels(arg, args[++i]));
      else if ((arg === "-ch_layout" || arg === "-channel_layout") && args.slice(i + 1).includes("-i")) {
        const layout = args[++i];
        if (layout !== "mono" && layout !== "stereo") return undefined;
        audioChannelOptions.push(["", layout === "mono" ? 1 : 2]);
      }
      else if (arg === "-hide_banner" || arg === "-nostdin" || arg === "-stats" || arg === "-nostats") continue;
      else if (arg === "-f") {
        const val = args[++i];
        if (inputs.length === 0 || (i + 1 < args.length && args.slice(i + 1).includes("-i"))) pendingFormat = val;
        else outputFormat = val;
      } else if (arg === "-itsscale" || arg.startsWith("-itsscale:")) {
        const value = args[++i];
        if (!args.slice(i + 1).includes("-i")) return undefined;
        pendingTimestampScales.push(parseTimestampScale(arg, value));
      } else if (arg === "-isync") {
        const value = args[++i];
        const reference = value?.trim() ? Number(value) : NaN;
        if (!Number.isInteger(reference) || reference < -1 || reference > 2147483647 || !args.slice(i + 1).includes("-i")) {
          throw new Error("Invalid -isync reference input");
        }
        pendingSyncReference = reference;
      } else if (arg === "-copypriorss") {
        const value = args[++i];
        if (value !== "0" && value !== "1") throw new Error("Invalid copypriorss: expected 0 or 1");
        copyPriorStart = value === "1";
      } else if (arg === "-copyinkf") {
        copyInitialNonKeyframes = true;
      } else if (arg === "-avoid_negative_ts") {
        const value = args[++i] ?? "";
        const modes: Record<string, string> = { "-1": "auto", "0": "disabled", "1": "make_non_negative", "2": "make_zero" };
        avoidNegativeTs = modes[value] ?? value;
        if (!["auto", "disabled", "make_non_negative", "make_zero"].includes(avoidNegativeTs)) throw new Error("Invalid avoid_negative_ts");
      } else if (arg === "-muxdelay") {
        const value = args[++i];
        muxDelay = value?.trim() ? Number(value) : NaN;
        if (!Number.isFinite(muxDelay) || muxDelay < 0 || muxDelay > 2147.483647) {
          throw new Error("Invalid muxdelay: expected seconds from 0 to 2147.483647");
        }
      } else if (arg === "-copyts") {
        copyTimestamps = true;
      } else if (arg === "-start_at_zero") {
        startAtZero = true;
      } else if (arg === "-itsoffset" || arg === "-output_ts_offset") {
        const value = parseHlsDuration(args[++i] ?? "");
        const beforeInput = args.slice(i + 1).includes("-i");
        if (!Number.isFinite(value) || (arg === "-itsoffset" ? !beforeInput : beforeInput)) return undefined;
        if (arg === "-itsoffset") pendingTimestampOffset = value;
        else outputTimestampOffset = value;
      } else if (arg === "-sseof") {
        const val = parseHlsDuration(args[++i] ?? "");
        if (!Number.isFinite(val) || val >= 0 || !args.slice(i + 1).includes("-i")) return undefined;
        pendingSseof = val;
      } else if (arg === "-ss") {
        const val = parseHlsDuration(args[++i] ?? "");
        if (!Number.isFinite(val)) return undefined;
        if (args.slice(i + 1).includes("-i")) pendingSs = val;
        else outputSs = val;
      } else if (arg === "-to") {
        const val = parseHlsDuration(args[++i] ?? "");
        if (!Number.isFinite(val)) return undefined;
        if (args.slice(i + 1).includes("-i")) pendingTo = val;
        else outputTo = val;
      } else if (arg === "-t") {
        const val = parseHlsDuration(args[++i] ?? "");
        if (!Number.isFinite(val) || val < 0) return undefined;
        if (args.slice(i + 1).includes("-i")) pendingDuration = val;
        else outputDuration = val;
      } else if (arg === "-stream_loop") pendingLoop = parseInt(args[++i] ?? "0", 10) || 0;
      else if (arg === "-kind") {
        pendingWebvttKind = args[++i];
        if (!["subtitles", "captions", "descriptions", "metadata"].includes(pendingWebvttKind ?? "") || !args.slice(i + 1).includes("-i")) return undefined;
      } else if (arg === "-sub_charenc") {
        pendingSubtitleCharset = args[++i];
        if (!pendingSubtitleCharset || !args.slice(i + 1).includes("-i")) return undefined;
      } else if (arg === "-sub_charenc_mode") {
        pendingSubtitleCharencMode = args[++i];
        if (!["ignore", "do_nothing", "auto", "pre_decoder"].includes(pendingSubtitleCharencMode ?? "") || !args.slice(i + 1).includes("-i")) return undefined;
      } else if (arg === "-subfps") {
        pendingSubtitleFrameRate = parseFrameRate(args[++i] ?? "");
        if (pendingSubtitleFrameRate === undefined || !args.slice(i + 1).includes("-i")) return undefined;
      } else if (arg === "-r" || arg === "-framerate") {
        const val = parseFrameRate(args[++i] ?? "");
        if (val === undefined) return undefined;
        if (args.slice(i + 1).includes("-i")) pendingFps = val;
        else outputFps = val;
      } else if (arg === "-s") outputSize = args[++i];
      else if (arg === "-fix_sub_duration") {
        if (!args.slice(i + 1).includes("-i")) return undefined;
        pendingFixSubDuration = true;
      } else if (arg === "-max_size") {
        const value = Number(args[++i]);
        if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff || !args.slice(i + 1).includes("-i")) {
          throw new Error("-max_size requires an integer from 0 to 2147483647 before an input");
        }
        pendingMaxSize = value;
      } else if (arg === "-ignore_length") {
        const value = args[++i];
        if ((value !== "0" && value !== "1") || !args.slice(i + 1).includes("-i")) {
          throw new Error("-ignore_length requires 0 or 1 before an input");
        }
        pendingIgnoreLength = value === "1";
      } else if (arg === "-skip_initial_bytes") {
        const value = Number(args[++i]);
        if (!Number.isSafeInteger(value) || value < 0 || !args.slice(i + 1).includes("-i")) return undefined;
        pendingSkipInitialBytes = value;
      } else if (arg === "-i") {
        if (pendingAudioDecoder !== undefined && !astPlugins.some(plugin => plugin.canDemux && plugin.supportedAudioCodecs.includes(pendingAudioDecoder!))) return undefined;
        pendingAudioDecoder = undefined;
        inputs.push({
          path: args[++i] ?? "",
          format: pendingFormat,
          sampleRate: audioRate,
          channels: audioChannelsForStream(audioChannelOptions, 0, 0),
          skipInitialBytes: pendingSkipInitialBytes,
          ignoreLength: pendingIgnoreLength,
          maxSize: pendingMaxSize,
          timestampOffset: pendingTimestampOffset,
          subtitleFrameRate: pendingSubtitleFrameRate,
          subtitleCharencMode: pendingSubtitleCharencMode,
          subtitleCharset: pendingSubtitleCharset,
          webvttKind: pendingWebvttKind,
          fixSubDuration: pendingFixSubDuration,
          syncReference: pendingSyncReference,
          startSeconds: pendingSs,
          endRelativeSeconds: pendingSseof,
          timestampScales: pendingTimestampScales,
          displayTransforms: pendingDisplayTransforms,
          endSeconds: pendingTo,
          durationSeconds: pendingDuration,
          streamLoop: pendingLoop,
          fps: pendingFps,
          startNumber: pendingStartNumber,
        });
        audioRate = undefined; audioChannelOptions = [];
        pendingTimestampScales = [];
        pendingDisplayTransforms = [];
        pendingTimestampOffset = 0;
        pendingSyncReference = undefined;
        pendingSubtitleFrameRate = undefined;
        pendingSubtitleCharencMode = undefined;
        pendingSubtitleCharset = undefined;
        pendingWebvttKind = undefined;
        pendingFixSubDuration = false;
        pendingSkipInitialBytes = 0;
        pendingIgnoreLength = false;
        pendingMaxSize = undefined;
        pendingFormat = undefined; pendingSs = undefined; pendingSseof = undefined; pendingTo = undefined; pendingDuration = undefined; pendingLoop = undefined; pendingFps = undefined; pendingStartNumber = undefined;
      } else if (arg === "-c" || arg === "-codec") {
        const val = args[++i]; videoCodec = val; audioCodec = val; subtitleCodec = val;
      } else if (arg === "-force_key_frames") return undefined;
      else if (arg === "-c:v" || arg === "-vcodec" || arg === "-codec:v") videoCodec = args[++i];
      else if (arg === "-c:a" || arg === "-acodec" || arg === "-codec:a") {
        const value = args[++i];
        if (args.slice(i + 1).includes("-i")) pendingAudioDecoder = value;
        else audioCodec = value;
      }
      else if (arg === "-c:s" || arg === "-scodec" || arg === "-codec:s") subtitleCodec = args[++i];
      else if (arg === "-an") stripAudio = true;
      else if (arg === "-vn") stripVideo = true;
      else if (arg === "-sn") stripSubtitles = true;
      else if (arg === "-shortest") shortest = true;
      else if (arg === "-frames" || arg.startsWith("-frames:") || arg === "-vframes" || arg === "-aframes") {
        const entry = parseFrameLimit(arg, args[++i]);
        frameLimits.push(entry);
        if (entry[0] === "v" || entry[0] === "") maxVideoFrames = entry[1] < 0 ? undefined : entry[1];
      }
      else if (arg === "-fs") fileSize = parseFileSize(args[++i]);
      else if (arg === "-id3v2_version") {
        const value = args[++i];
        if (value !== "0" && value !== "3" && value !== "4") throw new Error("Invalid ID3v2 version: expected 0, 3 or 4");
        id3v2Version = Number(value) as 0 | 3 | 4;
      } else if (arg === "-write_apetag") {
        const value = args[++i];
        if (value !== "0" && value !== "1") throw new Error("Invalid write_apetag: expected 0 or 1");
        writeApetag = value === "1";
      } else if (arg === "-pes_payload_size") {
        const value = args[++i];
        pesPayloadSize = value?.trim() ? Number(value) : NaN;
      } else if (arg === "-mpegts_start_pid") {
        const value = args[++i];
        mpegtsStartPid = value?.trim() ? Number(value) : NaN;
      } else if (arg === "-write_mpeg2") {
        writeMpeg2 = parseFilterBoolean(args[++i] ?? "invalid", "Invalid write_mpeg2: expected a Boolean");
      } else if (arg === "-write_id3v2") {
        const value = args[++i];
        if (value !== "0" && value !== "1") throw new Error("Invalid write_id3v2: expected 0 or 1");
        writeId3v2 = value === "1";
      } else if (arg === "-write_id3v1") {
        const value = args[++i];
        if (value !== "0" && value !== "1") throw new Error("Invalid write_id3v1: expected 0 or 1");
        writeId3v1 = value === "1";
      } else if (arg === "-sample_fmt") {
        sampleFormat = args[++i];
        if (!sampleFormat) throw new Error("Missing sample_fmt value");
      } else if (arg === "-ch_mode") {
        channelMode = args[++i];
        if (!channelMode) throw new Error("Missing ch_mode value");
      } else if (arg === "-trellis") {
        const value = args[++i];
        trellis = value?.trim() ? Number(value) : NaN;
        if (!Number.isInteger(trellis) || trellis < 0 || trellis > 16) throw new Error("Invalid trellis: expected an integer from 0 to 16");
      } else if (arg === "-block_size") {
        const value = args[++i];
        blockSize = value?.trim() ? Number(value) : NaN;
      } else if (arg === "-frame_size") {
        const value = args[++i];
        frameSize = value?.trim() ? Number(value) : NaN;
        if (!Number.isInteger(frameSize) || frameSize < 0 || frameSize > 2147483647) {
          throw new Error("Invalid frame_size: expected an integer from 0 to 2147483647");
        }
      } else if (arg === "-exact_rice_parameters") {
        const value = args[++i];
        exactRiceParameters = value?.trim() ? Number(value) : NaN;
      } else if (arg === "-multi_dim_quant") {
        const value = args[++i];
        multiDimQuant = value?.trim() ? Number(value) : NaN;
      } else if (arg === "-min_partition_order") {
        const value = args[++i];
        minPartitionOrder = value?.trim() ? Number(value) : NaN;
      } else if (arg === "-max_partition_order") {
        const value = args[++i];
        maxPartitionOrder = value?.trim() ? Number(value) : NaN;
      } else if (arg === "-min_prediction_order") {
        const value = args[++i];
        minPredictionOrder = value?.trim() ? Number(value) : NaN;
      } else if (arg === "-max_prediction_order") {
        const value = args[++i];
        maxPredictionOrder = value?.trim() ? Number(value) : NaN;
      } else if (arg === "-prediction_order_method") {
        predictionOrderMethod = args[++i] ?? "";
      } else if (arg === "-lpc_coeff_precision") {
        const value = args[++i];
        lpcCoeffPrecision = value?.trim() ? Number(value) : NaN;
      } else if (arg === "-lpc_passes") {
        const value = args[++i];
        lpcPasses = value?.trim() ? Number(value) : NaN;
      } else if (arg === "-lpc_type") {
        lpcType = args[++i] ?? "";
      } else if (arg === "-compression_level") {
        const value = args[++i];
        compressionLevel = value?.trim() ? Number(value) : NaN;
        if (!Number.isInteger(compressionLevel)) throw new Error("invalid compression_level value");
      } else if (arg === "-rle") {
        const value = args[++i];
        if (value !== "0" && value !== "1") throw new Error("rle must be 0 or 1");
        rle = value === "1";
      } else if (arg === "-global_palette") {
        const value = args[++i];
        if (value !== "0" && value !== "1") throw new Error("global_palette must be 0 or 1");
        globalPalette = value === "1";
      } else if (arg === "-final_delay") {
        const value = args[++i];
        finalDelay = value?.trim() ? Number(value) : NaN;
        if (!Number.isInteger(finalDelay) || finalDelay < -1 || finalDelay > 65535) throw new Error("Invalid final_delay: expected an integer from -1 to 65535");
      } else if (arg === "-plays") {
        const value = args[++i];
        apngPlays = value?.trim() ? Number(value) : NaN;
        if (!Number.isInteger(apngPlays) || apngPlays < 0 || apngPlays > 4294967295) throw new Error("Invalid plays: expected an integer from 0 to 4294967295");
      } else if (arg === "-mpegts_service_id") {
        const value = args[++i];
        mpegtsServiceId = value?.trim() ? Number(value) : NaN;
        if (!Number.isInteger(mpegtsServiceId) || mpegtsServiceId < 1 || mpegtsServiceId > 65535) {
          throw new Error("Invalid mpegts_service_id: expected an integer from 1 to 65535");
        }
      } else if (arg === "-serial_offset") {
        const value = args[++i];
        serialOffset = value?.trim() ? Number(value) : NaN;
        if (!Number.isInteger(serialOffset) || serialOffset < 0 || serialOffset > 2147483647) throw new Error("Invalid serial_offset: expected an integer from 0 to 2147483647");
      } else if (arg === "-bitexact") {
        bitexact = true;
      } else if (arg === "-fflags") {
        const value = args[++i];
        if (value === "autobsf" || value === "+autobsf" || value === "-autobsf") {
          if (!args.slice(i + 1).includes("-i")) autobsf = value !== "-autobsf";
        } else {
          if (value !== "bitexact" && value !== "+bitexact") throw new Error("Unsupported fflags: expected bitexact or autobsf");
          bitexact = true;
          serialOffset ??= 0;
          if (value === "bitexact" && !args.slice(i + 1).includes("-i")) autobsf = false;
        }
      } else if (arg === "-page_duration") {
        const value = args[++i];
        pageDuration = value?.trim() ? Number(value) : NaN;
        if (!Number.isSafeInteger(pageDuration) || pageDuration < 0) throw new Error("Invalid page_duration: expected nonnegative integer microseconds");
      } else if (arg === "-cluster_time_limit") {
        const value = args[++i];
        clusterTimeLimit = value?.trim() ? Number(value) : NaN;
        if (!Number.isSafeInteger(clusterTimeLimit) || clusterTimeLimit < -1) {
          throw new Error("Invalid cluster_time_limit: expected integer milliseconds from -1 to 9007199254740991");
        }
      } else if (arg === "-cues_to_front") {
        const value = args[++i];
        if (value === undefined) throw new Error("Invalid cues_to_front: expected a Boolean");
        cuesToFront = parseFilterBoolean(value, "Invalid cues_to_front: expected a Boolean");
      } else if (arg === "-reserve_index_space") {
        const value = args[++i];
        reserveIndexSpace = value?.trim() ? Number(value) : NaN;
        if (!Number.isInteger(reserveIndexSpace) || reserveIndexSpace < 0 || reserveIndexSpace > 2147483647) {
          throw new Error("Invalid reserve_index_space: expected an integer from 0 to 2147483647");
        }
      } else if (arg === "-metadata_header_padding") {
        const value = args[++i];
        metadataHeaderPadding = value?.trim() ? Number(value) : NaN;
        if (!Number.isInteger(metadataHeaderPadding) || metadataHeaderPadding < -1 || metadataHeaderPadding > 2147483647) {
          throw new Error("Invalid metadata_header_padding: expected an integer from -1 to 2147483647");
        }
      } else if (arg === "-write_tmcd") {
        const value = args[++i];
        if (value !== "0" && value !== "1" && value !== "-1") throw new Error("invalid write_tmcd value: expected -1, 0 or 1");
        writeTmcd = value !== "0";
      } else if (arg === "-write_channel_mask") {
        const value = args[++i];
        if (value !== "0" && value !== "1") throw new Error("invalid write_channel_mask value: expected 0 or 1");
        // FFmpeg retains the WAV channel mask for both values.
      } else if (arg === "-pat_period") {
        patPeriod = parseHlsDuration(args[++i] ?? "");
        if (!Number.isFinite(patPeriod) || patPeriod < 0) {
          throw new Error("Invalid pat_period: expected nonnegative seconds");
        }
      } else if (arg === "-write_crc32") {
        const value = args[++i];
        if (value !== "0" && value !== "1") throw new Error("invalid write_crc32 value: expected 0 or 1");
        writeCrc32 = value === "1";
      } else if (arg === "-write_bext") {
        const value = args[++i];
        if (value !== "0" && value !== "1") throw new Error("invalid write_bext value");
        writeBext = value === "1";
      } else if (arg === "-write_header") {
        const value = args[++i];
        if (value !== "0" && value !== "1") throw new Error("invalid write_header value: expected 0 or 1");
        writeHeader = value === "1";
      } else if (arg === "-write_xing") {
        const value = args[++i];
        if (value !== "0" && value !== "1") throw new Error("invalid write_xing value");
        writeXing = value === "1";
      } else if (arg === "-peak_block_size" || arg === "-peak_format" || arg === "-peak_ppv") {
        const value = args[++i];
        const number = value?.trim() ? Number(value) : NaN;
        const min = arg === "-peak_block_size" ? 0 : 1;
        const max = arg === "-peak_block_size" ? 65536 : 2;
        if (!Number.isInteger(number) || number < min || number > max) {
          throw new Error(`Invalid ${arg.slice(1)}: expected an integer from ${min} to ${max}`);
        }
        if (arg === "-peak_block_size") peakBlockSize = number;
        else if (arg === "-peak_format") peakFormat = number;
        else peakPpv = number;
      } else if (arg === "-write_peak") {
        const value = args[++i];
        const mode = value === "0" ? "off" : value === "1" ? "on" : value === "2" ? "only" : value;
        if (mode !== "off" && mode !== "on" && mode !== "only") {
          throw new Error("Invalid write_peak value: expected off, on or only");
        }
        writePeak = mode;
      } else if (arg === "-rf64") {
        const value = args[++i];
        if (value !== "always" && value !== "auto" && value !== "never") {
          throw new Error("Invalid rf64 value: expected always, auto or never");
        }
        rf64 = value;
      } else if (arg === "-pcr_period") {
        const value = args[++i];
        pcrPeriod = value?.trim() ? Number(value) : NaN;
      } else if (arg === "-muxrate") {
        muxRate = parseBitrate(args[++i]);
        if (muxRate === undefined) return undefined;
      } else if (arg === "-movie_timescale") {
        const value = args[++i];
        movieTimescale = value?.trim() ? Number(value) : NaN;
        if (!Number.isInteger(movieTimescale) || movieTimescale < 1 || movieTimescale > 2147483647) {
          throw new Error("-movie_timescale requires an integer from 1 to 2147483647");
        }
      } else if (arg === "-video_track_timescale") {
        const value = args[++i];
        videoTrackTimescale = value?.trim() ? Number(value) : NaN;
        if (!Number.isInteger(videoTrackTimescale) || videoTrackTimescale < 0 || videoTrackTimescale > 2147483647) {
          throw new Error("-video_track_timescale requires an integer from 0 to 2147483647");
        }
      } else if (arg === "-brand") {
        const value = args[++i];
        if (value === undefined) throw new Error("-brand requires a value");
        majorBrand = value.length >= 4 ? value.slice(0, 4) : undefined;
      } else if (arg === "-fragment_index") {
        const value = args[++i];
        fragmentIndex = value?.trim() ? Number(value) : NaN;
        if (!Number.isInteger(fragmentIndex) || fragmentIndex < 1 || fragmentIndex > 2147483647) {
          throw new Error("-fragment_index requires an integer from 1 to 2147483647");
        }
      } else if (arg === "-frag_duration") {
        const value = args[++i];
        fragmentDuration = value?.trim() ? Number(value) : NaN;
        if (!Number.isInteger(fragmentDuration) || fragmentDuration < 0 || fragmentDuration > 2147483647) {
          throw new Error("-frag_duration requires an integer from 0 to 2147483647 microseconds");
        }
        if (fragmentDuration > 0) fragmented = true;
      } else if (arg === "-default_mode") {
        defaultMode = args[++i] ?? "";
        if (!["passthrough", "infer", "infer_no_subs"].includes(defaultMode)) {
          throw new Error("-default_mode requires passthrough, infer, or infer_no_subs");
        }
      } else if (arg === "-live") {
        live = parseFilterBoolean(args[++i] ?? "invalid", "Invalid live value: expected a boolean");
      } else if (arg === "-tables_version") {
        mpegtsTablesVersion = parseMpegtsTablesVersion(args[++i] ?? "");
      } else if (arg === "-omit_video_pes_length") {
        omitVideoPesLength = parseFilterBoolean(args[++i] ?? "invalid", "Invalid omit_video_pes_length: expected a boolean");
      } else if (arg === "-mpegts_service_type") {
        mpegtsServiceType = parseMpegtsServiceType(args[++i] ?? "");
      } else if (arg === "-mpegts_flags") {
        mpegtsFlags = parseMpegtsFlags(args[++i] ?? "", mpegtsFlags);
      } else if (arg === "-movflags") {
        const flags = args[++i] ?? "";
        validateMovflags(flags);
        if (flags.includes("skip_trailer")) skipTrailer = true;
        if (flags.includes("write_colr")) writeColr = true;
        if (flags.includes("dash")) {
          segmentIndex ??= "fragment";
          emptyMoov = true;
          defaultBaseMoof = true;
          fragmented = true;
        }
        if (flags.includes("global_sidx")) segmentIndex = "global";
        if (flags.includes("default_base_moof")) defaultBaseMoof = true;
        if (!flags.startsWith("+") && !flags.startsWith("-")) { faststart = false; useMetadataTags = false; disableChpl = false; }
        for (const flag of flags.split("-").join("+-").split("+")) {
          if (flag === "disable_chpl") disableChpl = true;
          if (flag === "-disable_chpl") disableChpl = false;
          if (flag === "use_metadata_tags") useMetadataTags = true;
          if (flag === "-use_metadata_tags") useMetadataTags = false;
          if (flag === "faststart") faststart = true;
          if (flag === "-faststart") faststart = false;
        }
        if (flags.includes("empty_moov")) emptyMoov = true;
        if (flags.includes("frag_every_frame")) fragmentEveryFrame = true;
        if (flags.includes("frag_keyframe")) fragmentKeyframes = true;
        if (flags.includes("frag_keyframe") || flags.includes("frag_every_frame") || flags.includes("empty_moov")) fragmented = true;
      } else if (arg === "-vf" || arg === "-filter:v") {
        const f = args[++i]; if (f) vfFilters.push(f);
      } else if (arg === "-af" || arg === "-filter:a" || arg.startsWith("-af:") || arg.startsWith("-filter:a:")) {
        // Audio filtering and validation require the async command.
        return undefined;
      } else if (arg === "-disposition" || arg.startsWith("-disposition:")) {
        streamDispositions.push([arg.slice("-disposition:".length), args[++i] ?? ""]);
      } else if (arg === "-timecode") {
        metadata.timecode = args[++i] ?? "";
      } else if (arg === "-metadata" || arg.startsWith("-metadata:")) {
        const type = arg["-metadata:".length] ?? "g";
        if (type !== "g" && type !== "s" && type !== "c" && type !== "p") return undefined;
        if (arg === "-metadata:s" || arg.startsWith("-metadata:s:")) {
          validateMetadataStreamSpecifier(arg.slice("-metadata:s:".length));
        }
        const kv = args[++i] ?? "";
        const eq = kv.indexOf("=");
        if (eq < 0) return undefined;
        if (eq >= 0) {
          const k = kv.slice(0, eq).trim().toLowerCase();
          const v = kv.slice(eq + 1);
          if ((k === "language" || k === "handler_name" || k === "timecode" || k === "title" || k === "comment" || k === "stereo_mode") && (arg === "-metadata:s" || arg.startsWith("-metadata:s:"))) {
            streamMetadata.push([arg.slice("-metadata:s:".length), k === "handler_name" ? "handlerName" : k, v]);
          } else if (arg !== "-metadata:s" && !arg.startsWith("-metadata:s:")) metadata[k] = v;
        }
      } else if (["-color_primaries", "-color_trc", "-colorspace", "-color_range"].includes(arg.split(":")[0]!)) {
        outputColors.push(parseOutputColorOption(arg, args[++i]));
      } else if (arg === "-aspect" || arg.startsWith("-aspect:")) {
        displayAspects.push(parseDisplayAspect(arg, args[++i]));
      } else if (["-display_rotation", "-display_hflip", "-display_vflip"].some(option => arg === option || arg.startsWith(`${option}:`))) {
        pendingDisplayTransforms.push(parseDisplayTransform(arg, arg.split(":")[0] === "-display_rotation" ? args[++i] : undefined));
        if (!args.slice(i + 1).includes("-i")) return undefined;
      }
      else if (arg.startsWith("-") && arg !== "-") return undefined;
      else {
        // Multi-output and trailing groups use the async path before any writes.
        if (i + 1 < args.length) return undefined;
        outputTarget = arg;
      }
    }

    if (inputs.length === 0 || !outputTarget || outputTarget.startsWith("md5:") || inputs.some(input => input.path.startsWith("concat:"))) return undefined;
    if (fileSize !== undefined && (audioCodec !== "copy" ||
      (outputFormat ? registry.findByFormatName(outputFormat) : registry.findByFilename(outputTarget))?.id !== "wav")) return undefined;
    // Output resampling and channel mixing require the async audio filter path.
    if (audioRate !== undefined || audioChannelOptions.length) return undefined;
    if (outputDuration === undefined && outputTo !== undefined && outputTo <= (outputSs ?? 0)) return undefined;
    if (outputFormat === "segment" || outputFormat === "tee" || outputTarget.startsWith("tee:")) return undefined;
    const isNullMux = outputFormat === "null";
    if (!isNullMux && !isStdout(outputTarget) && inputs.some(input =>
      input.format !== "lavfi" && !isStdin(input.path) && input.path === outputTarget)) return undefined;
    if (!isNullMux && !writeFileSync) return undefined;
    if (noOverwrite !== false && !isNullMux && (!readFileSync || readFileSync(outputTarget))) return undefined;

    const outPlugin = outputFormat ? (registry.findById(outputFormat) ?? registry.findByFormatName(outputFormat)) : registry.findByFilename(outputTarget);
    // H.264 encoding needs the cooperative async path; image output can ignore -bf 0.
    if (maxBFrames !== undefined && videoCodec !== "copy" &&
      (maxBFrames > 0 || outPlugin?.id === "mp4" || outPlugin?.id === "mov")) return undefined;
    const loadedDocs: MediaDocument[] = [];
    const inputStarts: (number | undefined)[] = [];
    for (const inp of inputs) {
      let doc: MediaDocument;
      if (inp.format === "lavfi") {
        // Undefined declines the shell's synchronous optimization; the async
        // command runs lavfiSteps and yields between sample/pixel batches.
        return undefined;
      } else {
        if (inp.path.startsWith("data:")) return undefined;
        let rawBytes = isStdin(inp.path) ? inBytes : readFileSync?.(inp.path);
        if (!rawBytes || rawBytes.byteLength > 262144) return undefined;
        budget.checkInputBytes(rawBytes.byteLength);
        rawBytes = rawBytes.subarray(inp.skipInitialBytes ?? 0);
        const plugin = inp.format !== undefined
          ? registry.findByFormatName(inp.format)
          : registry.detect(rawBytes, inp.path);
        if (!plugin || !plugin.canDemux) return undefined;
        if (plugin.id === "au" && rawBytes.length >= 12 &&
          new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength).getUint32(8) === 0) return undefined;
        doc = plugin.parse(rawBytes, { seekable: !isStdin(inp.path), decodeSubtitles: subtitleCodec !== "copy", decodeAudio: audioCodec !== "copy" || !(["flac", "ogg", "wav", "w64", "aiff", "wv", "mp4", "mov", "latm"].includes(plugin.id) || plugin.supportedAudioCodecs.includes(`pcm_${plugin.id}`)), filename: inp.path, budget, webvttKind: inp.webvttKind, subtitleFrameRate: inp.subtitleFrameRate, sampleRate: inp.sampleRate, channels: inp.channels, maxSize: inp.maxSize, ignoreLength: inp.ignoreLength });
        if (doc.tracks.some(track => track.demuxError || track.decodeErrors?.length)) return undefined;
        const imageOutput = (outputFormat ? (registry.findById(outputFormat) ?? registry.findByFormatName(outputFormat)) : registry.findByFilename(outputTarget))?.id === "image2";
        if (imageOutput && videoCodec === "copy") return undefined;
        if ((imageOutput || (maxVideoFrames !== undefined && videoCodec !== "copy")) && doc.tracks.some(track => track.type === "video" && !track.decodedVideoFrames)) return undefined;
      }
      const sourceStart = inputStartTime(doc, budget, outPlugin?.id);
      inputStarts.push(sourceStart);
      if ((videoCodec === "copy" || audioCodec === "copy") && (!copyTimestamps || startAtZero)) doc = shiftTimestamps(doc, -(sourceStart ?? 0), budget);
      doc = scaleInputTimestamps(doc, inp.timestampScales, budget);
      doc = applyInputDisplayTransforms(doc, inp.displayTransforms);
      if (inp.subtitleCharset !== undefined && subtitleCodec !== "copy" && inp.subtitleCharencMode !== "ignore" && inp.subtitleCharencMode !== "do_nothing") doc = recodeSubtitles(doc, inp.subtitleCharset);
      if (inp.fixSubDuration && subtitleCodec !== "copy") doc = fixSubtitleDurations(doc);
      const startSeconds = inp.startSeconds ?? (inp.endRelativeSeconds === undefined
        ? undefined : Math.max(0, doc.durationSeconds + inp.endRelativeSeconds));
      if (audioCodec !== "copy" && !stripAudio) doc = decodeAacInput(doc);
      if (audioCodec === "copy" && (startSeconds !== undefined || outputSs !== undefined) &&
          doc.tracks.some(track => track.codecDescriptions[0]?.codecName === `pcm_${doc.containerFormat}`)) return undefined;
      if (inp.streamLoop && inp.streamLoop > 0) {
        doc = concatMp4(Array.from({ length: inp.streamLoop + 1 }, () => doc), { budget });
      }
      if (startSeconds !== undefined || inp.endSeconds !== undefined || inp.durationSeconds !== undefined) {
        doc = sliceMp4(doc, { inputSeek: startSeconds !== undefined, startSeconds, endSeconds: inp.endSeconds, durationSeconds: inp.durationSeconds, copyAudio: audioCodec === "copy" });
        if (videoCodec === "copy" && !copyPriorStart && startSeconds !== undefined) doc = discardOutputPreroll(doc, { video: videoCodec }, copyInitialNonKeyframes);
      }
      if (inp.streamLoop === -1) {
        doc = loopToOutputEnd(doc, outputDuration === undefined ? outputTo : (outputSs ?? 0) + outputDuration, budget);
      }
      if (subtitleCodec !== "copy" && inp.subtitleCharencMode !== "ignore") doc = validateSubtitleText(doc, false);
      loadedDocs.push(shiftTimestamps(doc, inp.timestampOffset ?? 0, budget));
    }

    if (outputFormat === "image2pipe") return undefined;
    synchronizeInputs(loadedDocs, inputs, inputStarts, copyTimestamps, startAtZero, budget);
    if (outPlugin?.id === "image2" && outputStartNumber !== undefined && outputStartNumber > 2147483647) return undefined;
    // MP4/MOV have no default subtitle encoder for automatic stream selection.
    if (subtitleCodec === undefined && (outPlugin?.id === "mp4" || outPlugin?.id === "mov")) stripSubtitles = true;
    let workingDoc = muxMp4(selectAutomaticStreams(loadedDocs), { stripAudio, stripVideo, stripSubtitles });
    if (shortest) workingDoc = limitCopyPackets(workingDoc, [], { video: videoCodec, audio: audioCodec, subtitle: subtitleCodec }, true);
    if (workingDoc.tracks.length === 0 && outPlugin?.id !== "ffmetadata") return undefined;
    validateAudioEncoder(audioCodec, workingDoc, astPlugins);
    if ((audioCodec === "adpcm_ima_wav" || audioCodec === "adpcm_ms") && workingDoc.tracks.some(track =>
      track.type === "audio" && (track.decodedAudio?.channels ?? track.codecDescriptions[0]?.channels ?? 0) > 2)) return undefined;
    if (subtitleCodec !== "copy") workingDoc = transcodeSubtitles(workingDoc,
      outPlugin?.id, subtitleCodec);
    if (outputSs !== undefined || outputTo !== undefined || outputDuration !== undefined) {
      if (audioCodec === "copy" && outputSs !== undefined) {
        workingDoc = { ...workingDoc, tracks: workingDoc.tracks.map(track =>
          workingDoc.containerFormat === "au" || track.codecDescriptions[0]?.codecName === `pcm_${workingDoc.containerFormat}`
            ? { ...track, samples: track.samples.filter(sample => sample.pts >= outputSs * track.timescale) }
            : track) };
      }
      workingDoc = sliceMp4(workingDoc, { startSeconds: outputSs, endSeconds: outputDuration === undefined ? outputTo : undefined, durationSeconds: outputDuration, copyAudio: audioCodec === "copy" });
      if (outputSs !== undefined) workingDoc = discardOutputPreroll(workingDoc, { video: videoCodec, audio: audioCodec }, copyInitialNonKeyframes);
    }
    const streamFrameLimits = outputFrameLimits(workingDoc.tracks, frameLimits);
    workingDoc = limitCopyPackets(workingDoc, streamFrameLimits, { video: videoCodec, audio: audioCodec, subtitle: subtitleCodec });
    for (const type of ["video", "audio", "subtitle"] as const) {
      const limits = workingDoc.tracks.flatMap((track, index) => track.type === type ? [streamFrameLimits[index]] : []);
      const maximum = limits.some(limit => limit !== undefined) ? Math.max(...limits.map(limit => limit ?? Infinity)) : undefined;
      if (type === "video") maxVideoFrames = maximum;
      else if (type === "audio") maxAudioFrames = maximum;
      else maxSubtitleFrames = maximum;
    }
    if (maxAudioFrames !== undefined && audioCodec !== "copy") return undefined;
    if (outputSize && videoCodec !== "copy") {
      const [w, h] = outputSize.toLowerCase().split("x");
      if (w && h) vfFilters.push(`scale=${w}:${h}`);
    }
    if (outputFps && videoCodec !== "copy") vfFilters.push(`fps=${outputFps}`);
    if (vfFilters.length > 0) {
      // Filtering needs the cooperative async command, not a sync shortcut.
      return undefined;
    }
    if (maxSubtitleFrames !== undefined) {
      workingDoc = {
        ...workingDoc,
        tracks: workingDoc.tracks.map((track, index) => track.type === "subtitle"
          ? { ...track, samples: track.samples.slice(0, streamFrameLimits[index]) } : track)
      };
    }
    if (maxVideoFrames !== undefined) {
      workingDoc = {
        ...workingDoc,
        tracks: workingDoc.tracks.map((t, index) => {
          if (t.type !== "video") return t;
          const maxVideoFrames = streamFrameLimits[index];
          if (maxVideoFrames === undefined) return t;
          if (t.decodedVideoFrames && t.decodedVideoFrames.length > maxVideoFrames!) {
            return { ...t, samples: [], decodedVideoFrames: t.decodedVideoFrames.slice(0, maxVideoFrames) };
          }
          if (t.samples.length > maxVideoFrames!) {
            const slicedSamples = t.samples.slice(0, maxVideoFrames);
            return { ...t, duration: slicedSamples.reduce((acc, s) => acc + s.duration, 0), samples: slicedSamples };
          }
          return t;
        }),
      };
    }
    chapterSource ??= loadedDocs.findIndex(doc => doc.chapters?.length);
    if (chapterSource >= loadedDocs.length) return undefined;
    workingDoc = { ...workingDoc, chapters: chapterSource < 0 ? undefined : outputChapters(loadedDocs[chapterSource]!.chapters, outputSs, outputDuration, outputTo) };
    const sourceMetadata = mapGlobalMetadata(loadedDocs, metadataSources);
    const metaTags: Mp4MetadataTags = {
      ...sourceMetadata,
      description: metadata.description ?? sourceMetadata.description,
      compilation: metadata.compilation ?? sourceMetadata.compilation,
      custom: writeBext || useMetadataTags || outPlugin?.id === "aiff" || outPlugin?.id === "mpegts" ? { ...sourceMetadata.custom, ...metadata } : sourceMetadata.custom,
      title: metadata.title ?? sourceMetadata.title,
      artist: metadata.artist ?? sourceMetadata.artist,
      composer: metadata.composer ?? sourceMetadata.composer,
      albumArtist: metadata.album_artist ?? sourceMetadata.albumArtist,
      copyright: metadata.copyright ?? sourceMetadata.copyright,
      album: metadata.album ?? sourceMetadata.album,
      date: metadata.date ?? metadata.year ?? sourceMetadata.date,
      comment: metadata.comment ?? sourceMetadata.comment,
      genre: metadata.genre ?? sourceMetadata.genre,
      trackNumber: metadata.track ?? sourceMetadata.trackNumber,
      discNumber: metadata.disc ?? sourceMetadata.discNumber,
      encoder: (outPlugin?.id === "ffmetadata" || outPlugin?.id === "wav" || outPlugin?.id === "flac") ? (bitexact ? undefined : "Lavf61.7.100") : metadata.encoder ?? sourceMetadata.encoder,
    };
    workingDoc = { ...workingDoc, faststart, metadata: metaTags, tracks: applyStreamDispositions(applyStreamMetadata(mapStreamMetadata(workingDoc.tracks, loadedDocs, streamMetadataMaps), streamMetadata, metadataSources.at(-1)), streamDispositions, outPlugin?.id, defaultMode) };
    if (outPlugin?.id === "mp4" || outPlugin?.id === "mov") {
      workingDoc = { ...workingDoc, tracks: writeTmcd ? authorTimecode(workingDoc.tracks, metadata.timecode) : removeTimecode(workingDoc.tracks) };
    }
    workingDoc = applyDisplayAspects(workingDoc, displayAspects);
    workingDoc = applyOutputColors(workingDoc, outputColors);
    workingDoc = shiftTimestamps(workingDoc, outputTimestampOffset, budget);
    workingDoc = avoidNegativeTimestamps(workingDoc, avoidNegativeTs === "auto" && outPlugin?.id === "srt" ? "make_non_negative" : avoidNegativeTs, budget);
    if (isNullMux) return "";
    if (inputs.some(inp => isStdin(inp.path)) && !inBytes) return undefined;
    if (!writeFileSync || !outputTarget || outputTarget.endsWith("/") || outputTarget.endsWith("/.") || outputTarget.includes("/./") || /(?:^|\/)\.\.(?:\/|$)/u.test(outputTarget)) return undefined;
    if ((outputFormat ?? outputTarget.split(".").pop()?.toLowerCase()) === "ico") {
      if (videoCodec !== "png" || isStdout(outputTarget)) return undefined;
      if (maxVideoFrames === 0) return "";
      if (workingDoc.tracks.some(track => track.type !== "video" || !track.decodedVideoFrames?.length || track.editList?.length)) return undefined;
      const bytes = encodeIcoFrames(workingDoc.tracks.map(track => track.decodedVideoFrames![0]!), budget);
      return writeFileSync(outputTarget, bytes) ? "" : undefined;
    }
    if ((outputFormat ?? outputTarget.split(".").pop()?.toLowerCase()) === "apng") {
      if (videoCodec === "copy" || isStdout(outputTarget)) return undefined;
      if (maxVideoFrames === 0) return "";
      const track = workingDoc.tracks.find(track => track.type === "video");
      if (!track?.decodedVideoFrames || track.editList?.length) return undefined;
      const bytes = encodeApngFrames(track.decodedVideoFrames.slice(0, maxVideoFrames), apngPlays, budget);
      return writeFileSync(outputTarget, bytes) ? "" : undefined;
    }
    if (formatImageSequence(outputTarget, outputStartNumber ?? 1) !== undefined) {
      if (videoCodec !== undefined && videoCodec !== "copy" && !imageEncoders.includes(videoCodec)) return undefined;
      const outExt = outputTarget.split(".").pop()?.toLowerCase() ?? "png";
      const vTrack = workingDoc.tracks.find((t) => t.type === "video");
      if (vTrack && !vTrack.decodedVideoFrames) return undefined;
      const frames = vTrack?.decodedVideoFrames ?? [];
      const limit = Math.min(frames.length, maxVideoFrames ?? Infinity);
      const imgFmt = imageOutputFormat(videoCodec, outExt);
      for (let idx = 0; idx < limit; idx++) {
        const f = frames[idx]!;
        const fileName = formatImageSequence(outputTarget, idx + (outputStartNumber ?? 1))!;
        const encoded = imgFmt === "tga" ? encodeTga(f, { rle, budget }) : encodeImage({ ...makeRgbaImg(f.width, f.height, f.data),
                    ...(imgFmt === "qoi" ? { hasAlpha: !["rgb24", "bgr24", "rgb48be", "gray", "gray8", "gray16be", "monob"].includes(vTrack?.codecDescriptions[0]?.pixFmt ?? "rgba") } : {}),
                    ...(vTrack?.codecDescriptions[0]?.pixFmt === "pal8"
                      ? { pngPalette: { bytes: pal8Palette, depth: 8 } } : {}),
                    ...(vTrack?.codecDescriptions[0]?.pixFmt === "monob" || vTrack?.codecDescriptions[0]?.pixFmt === "gray" || vTrack?.codecDescriptions[0]?.pixFmt === "gray8"
                      ? { space: "b-w" as const, channels: 1 as const, hasAlpha: false }
                      : vTrack?.codecDescriptions[0]?.pixFmt === "ya8"
                        ? { space: "b-w" as const, channels: 2 as const, hasAlpha: true } : {}),
                    ...(imgFmt === "png" && vTrack?.codecDescriptions[0]?.sarWidth && vTrack.codecDescriptions[0].sarHeight &&
                      vTrack.codecDescriptions[0].sarWidth !== vTrack.codecDescriptions[0].sarHeight ? {
                      resolution: { x: vTrack.codecDescriptions[0].sarWidth, y: vTrack.codecDescriptions[0].sarHeight, unit: "unknown" as const }
                    } : {}) }, { format: imgFmt, pngBitDepth: vTrack?.codecDescriptions[0]?.pixFmt === "monob" ? 1 : undefined, pngPreserveColormap: vTrack?.codecDescriptions[0]?.pixFmt === "pal8" }).data;
        if (!writeFileSync!(fileName, encoded)) return undefined;
      }
      return "";
    }
    if (!outPlugin || !outPlugin.canMux || outPlugin.id === "dash" || outPlugin.id === "hls") return undefined;
    if (outPlugin.id === "image2" && maxVideoFrames === 0) return "";
    const outExt = outputTarget.split(".").pop()?.toLowerCase();
    if (workingDoc.tracks.some(track => track.decodeErrors?.length)) return undefined;
    workingDoc = { ...workingDoc, tracks: filterBitstream(filterBitstream(filterBitstream(workingDoc.tracks, videoBitstreamFilter, budget, "video", workingDoc.timescale), audioBitstreamFilter, budget, "audio", workingDoc.timescale), subtitleBitstreamFilter, budget, "subtitle", workingDoc.timescale) };
    if (autobsf && videoCodec === "copy" && (outPlugin?.id === "mkv" || outPlugin?.id === "webm" || outPlugin?.id === "mp4")) {
      workingDoc = { ...workingDoc, tracks: mergeVp9Superframes(workingDoc.tracks, budget) };
    }
    workingDoc = applyVideoTag(workingDoc, outPlugin.id, videoCodec, videoTag);
    validateRawAudioCodec(workingDoc, outPlugin, audioCodec);
    validateStreamCopy(workingDoc, outPlugin.id, { video: videoCodec, audio: audioCodec, subtitle: subtitleCodec });
    validateSubtitleEncoder(subtitleCodec, workingDoc, outPlugin.id);
    if (movieTimescale !== undefined && (outPlugin.id === "mp4" || outPlugin.id === "mov")) {
      workingDoc = rescaleMovie(workingDoc, movieTimescale);
    }
    if (videoTrackTimescale && (outPlugin.id === "mp4" || outPlugin.id === "mov")) {
      workingDoc = rescaleVideoTracks(workingDoc, videoTrackTimescale, budget);
    }
    const serializedBytes = serializeLimitedWav(workingDoc, outPlugin, { patPmtAtFrames: (mpegtsFlags & 16) !== 0, patPeriod, muxDelay, pesPayloadSize, omitVideoPesLength, mpegtsTablesVersion, mpegtsServiceType, mpegtsLatm: !!(mpegtsFlags & 8), initialDiscontinuity: !!(mpegtsFlags & 32), mpegtsOmitRai: !!(mpegtsFlags & 64), live, writeHeader, writeBext, writeCrc32, muxRate, pcrPeriod, rf64, writePeak, peakBlockSize, peakFormat, peakPpv, audioCodec, videoCodec, audioBitrate, format: outputFormat ?? outExt, compressionLevel, blockSize, trellis, frameSize, channelMode, lpcType, lpcPasses, lpcCoeffPrecision, minPartitionOrder, maxPartitionOrder, exactRiceParameters, minPredictionOrder, maxPredictionOrder, predictionOrderMethod, multiDimQuant, sampleFormat, pageDuration, serialOffset, mpegtsServiceId, writeXing, faststart, useMetadataTags, disableChpl, writeColr, majorBrand, skipTrailer, defaultBaseMoof, segmentIndex, fragmented, fragmentKeyframes: fragmentKeyframes || (fragmented && !fragmentEveryFrame && !fragmentDuration && segmentIndex !== undefined), fragmentEveryFrame, fragmentDuration, fragmentIndex, emptyMoov, id3v2Version, writeApetag, writeId3v2, writeMpeg2, mpegtsStartPid, writeId3v1, metadataHeaderPadding, reserveIndexSpace, cuesToFront, clusterTimeLimit, finalDelay, globalPalette, rle, metadata: metaTags, budget }, fileSize);
    if (outputTarget === "/dev/null") return "";
    if (isStdout(outputTarget)) return undefined;
    if (!writeFileSync!(outputTarget, serializedBytes)) return undefined;
    return "";
  } catch {
    return undefined;
  }
}

function formatImageSequence(pattern: string, number: number, allowMultiple = true, preservePercent = false): string | undefined {
  let filename = "";
  let numbered = false;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== "%") {
      filename += pattern[i];
      continue;
    }
    i++;
    if (pattern[i] === "%") {
      filename += preservePercent ? "%%" : "%";
      continue;
    }
    let width = 0;
    while (i < pattern.length && pattern[i]! >= "0" && pattern[i]! <= "9") {
      width = width * 10 + Number(pattern[i]);
      i++;
    }
    if (pattern[i] !== "d") return undefined;
    if (numbered && !allowMultiple) throw new Error("Numbered image2 input requires a single numeric field");
    filename += (number < 0 ? "-" : "") + String(Math.abs(number)).padStart(width, "0");
    numbered = true;
  }
  return numbered ? filename : undefined;
}

function* expandImageGlob(pattern: string, budget: MediaBudgetTracker): Generator<string> {
  const pending = [pattern];
  while (pending.length > 0) {
    budget.checkCpu();
    const current = pending.pop()!;
    let start = -1;
    let depth = 0;
    const separators: number[] = [];
    let expanded = false;
    for (let i = 0; i < current.length; i++) {
      budget.checkCpu();
      const token = current[i];
      if (token === "\\") { i++; continue; }
      if (token === "{") {
        if (depth++ === 0) start = i;
      } else if (token === "," && depth === 1) {
        separators.push(i);
      } else if (token === "}" && depth > 0 && --depth === 0) {
        if (separators.length > 0) {
          const boundaries = [start, ...separators, i];
          // Stack in reverse so alternatives are visited in their original order.
          for (let j = boundaries.length - 2; j >= 0; j--) {
            budget.checkCpu();
            pending.push(current.slice(0, start) + current.slice(boundaries[j]! + 1, boundaries[j + 1]) + current.slice(i + 1));
          }
          expanded = true;
          break;
        }
      }
    }
    if (!expanded) yield current;
  }
}

function matchesImageGlob(pattern: string, name: string, budget: MediaBudgetTracker): boolean {
  // C-locale glob tokens consume UTF-8 bytes, including literals and brackets.
  pattern = Array.from(encodeUtf8(pattern), byte => String.fromCharCode(byte)).join("");
  const characters = Array.from(encodeUtf8(name), byte => String.fromCharCode(byte));
  let positions = new Set([0]);
  for (let i = 0; i < pattern.length; i++) {
    budget.checkCpu();
    const token = pattern[i]!;
    const next = new Set<number>();
    if (token === "*") {
      let start = characters.length;
      for (const p of positions) start = Math.min(start, p);
      for (let p = start; p <= characters.length; p++) next.add(p);
    } else {
      let literal = token;
      let contents: string | undefined;
      if (token === "\\") literal = pattern[++i] ?? "\\";
      if (token === "[") {
        let end = i + 1;
        if (pattern[end] === "!" || pattern[end] === "^") end++;
        if (pattern[end] === "]") end++;
        while (end < pattern.length && pattern[end] !== "]") {
          if (pattern[end] === "\\" && end + 1 < pattern.length) end += 2;
          else if (pattern.startsWith("[:", end) && pattern.indexOf(":]", end + 2) !== -1) {
            end = pattern.indexOf(":]", end + 2) + 2;
          } else end++;
        }
        if (end < pattern.length) { contents = pattern.slice(i + 1, end); i = end; }
      }
      for (const p of positions) {
        budget.checkCpu();
        const character = characters[p];
        if (character === undefined) continue;
        let matches = token === "?" || character === literal;
        if (contents !== undefined) {
          const negated = contents[0] === "!" || contents[0] === "^";
          let included = false;
          for (let c = negated ? 1 : 0; c < contents.length; c++) {
            budget.checkCpu();
            if (contents.startsWith("[:", c)) {
              const end = contents.indexOf(":]", c + 2);
              if (end !== -1) {
                const lower = character >= "a" && character <= "z";
                const upper = character >= "A" && character <= "Z";
                const digit = character >= "0" && character <= "9";
                // POSIX character classes use the C locale, like byte-wise ranges.
                const classes: Record<string, boolean> = {
                  alnum: lower || upper || digit,
                  alpha: lower || upper,
                  blank: character === " " || character === "\t",
                  cntrl: character < " " || character === "\x7f",
                  digit,
                  graph: character >= "!" && character <= "~",
                  lower,
                  print: character >= " " && character <= "~",
                  punct: character >= "!" && character <= "~" && !lower && !upper && !digit,
                  space: " \t\n\r\v\f".includes(character),
                  upper,
                  xdigit: digit || (character >= "a" && character <= "f") || (character >= "A" && character <= "F")
                };
                const className = contents.slice(c + 2, end);
                if (!Object.hasOwn(classes, className)) return false;
                included ||= classes[className]!;
                c = end + 1;
                continue;
              }
            }
            let start = contents[c]!;
            if (start === "\\" && c + 1 < contents.length) start = contents[++c]!;
            if (contents[c + 1] === "-" && c + 2 < contents.length) {
              included ||= character >= start && character <= contents[c + 2]!;
              c += 2;
            } else included ||= character === start;
          }
          matches = negated ? !included : included;
        }
        if (matches) next.add(p + 1);
      }
    }
    positions = next;
    if (positions.size === 0) return false;
  }
  return positions.has(characters.length);
}

interface InputSpec {
  readonly guessLayoutMax?: number | undefined;
  readonly videoSize?: string | undefined;
  readonly pixelFormat?: string | undefined;
  readonly dumpAttachments?: readonly [string, string][];
  readonly sampleRate?: number | undefined;
  readonly channels?: number | undefined;
  readonly path: string;
  readonly format?: string | undefined;
  readonly safe?: boolean | undefined;
  readonly autoConvert?: boolean | undefined;
  readonly segmentTimeMetadata?: boolean | undefined;
  readonly allowedExtensions?: string | undefined;
  readonly timestampOffset?: number | undefined;
  readonly subtitleFrameRate?: number | undefined;
  readonly subtitleCharencMode?: string | undefined;
  readonly subtitleCharset?: string | undefined;
  readonly webvttKind?: string | undefined;
  readonly fixSubDuration?: boolean | undefined;
  readonly skipInitialBytes?: number | undefined;
  readonly ignoreLength?: boolean | undefined;
  readonly maxSize?: number | undefined;
  readonly syncReference?: number | undefined;
  readonly startSeconds?: number | undefined;
  readonly endRelativeSeconds?: number | undefined;
  readonly timestampScales: readonly [string, number][];
  readonly displayTransforms: readonly DisplayTransform[];
  readonly endSeconds?: number | undefined;
  readonly durationSeconds?: number | undefined;
  readonly streamLoop?: number | undefined;
  readonly ignoreLoop?: boolean | undefined;
  readonly imageLoop?: boolean | undefined;
  readonly fps?: number | undefined;
  readonly startNumber?: number | undefined;
  readonly startNumberRange?: number | undefined;
  readonly patternType?: "glob" | "glob_sequence" | "none" | "sequence" | undefined;
}

export function createFfmpegCommand(options: FfmpegCommandsOptions = {}): CommandDefinition {
  const astPlugins = options.asts ?? allMediaAsts();
  const registry = createMediaAstRegistry(astPlugins);
  const features = options.features ?? {};

  return {
    name: "ffmpeg",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Multimedia converter, merger, and stream processor powered by pluggable ASTs",
    async execute(context: CommandContext) {
      const budget = new MediaBudgetTracker(options.limits);
      const readSource = createInputReader(context, budget);
      const argsObj = getCommandArguments(context);
      const args = argsObj.args;

      if (args.length === 0) {
        await writeBytes(
          context.stderr,
          encodeUtf8(formatIntrospectionOutput("-h", astPlugins)),
          context.signal
        );
        return { exitCode: 1 };
      }

      for (const arg of args) {
        if (
          arg === "-version" ||
          arg === "--version" ||
          arg === "-h" ||
          arg === "-help" ||
          arg === "--help" ||
          arg === "-formats" ||
          arg === "-demuxers" ||
          arg === "-muxers" ||
          arg === "-codecs" ||
          arg === "-decoders" ||
          arg === "-encoders" ||
          arg === "-protocols" ||
          arg === "-filters"
        ) {
          await writeBytes(
            context.stdout,
            encodeUtf8(formatIntrospectionOutput(arg, astPlugins)),
            context.signal
          );
          return { exitCode: 0 };
        }
      }

      const inputs: InputSpec[] = [];
      let pendingDumpAttachments: [string, string][] = [];
      const dumpedInputs = new Set<InputSpec>();
      let pendingFormat: string | undefined;
      let pendingAllowedExtensions: string | undefined;
      let pendingSafe: boolean | undefined;
      let pendingAutoConvert: boolean | undefined;
      let pendingSegmentTimeMetadata: boolean | undefined;
      let pendingAudioDecoder: string | undefined;
      let pendingTimestampOffset = 0;
      let pendingSyncReference: number | undefined;
      let copyInitialNonKeyframes = false;
      let copyTimestamps = false;
      let startAtZero = false;
      let pendingSubtitleFrameRate: number | undefined;
      let pendingSubtitleCharencMode: string | undefined;
      let pendingSubtitleCharset: string | undefined;
      let pendingWebvttKind: string | undefined;
      let pendingFixSubDuration = false;
      let pendingSkipInitialBytes = 0;
      let pendingIgnoreLength = false;
      let pendingMaxSize: number | undefined;
      let pendingSs: number | undefined;
      let pendingTimestampScales: [string, number][] = [];
      let pendingDisplayTransforms: DisplayTransform[] = [];
      let pendingSseof: number | undefined;
      let pendingTo: number | undefined;
      let pendingDuration: number | undefined;
      let pendingLoop: number | undefined;
      let pendingIgnoreLoop: boolean | undefined;
      let pendingImageLoop: boolean | undefined;
      let pendingFps: number | undefined;
      let pendingVideoSize: string | undefined;
      let pendingPixelFormat: string | undefined;
      let pendingStartNumber: number | undefined;
      let pendingStartNumberRange: number | undefined;
      let pendingPatternType: InputSpec["patternType"];
      let pendingGuessLayoutMax: number | undefined;
      let pendingChannelLayout: string | undefined;
      let overwrite: boolean | undefined;
      let exitOnError = false;
      let maxErrorRate = Math.fround(2 / 3);
      let abortOnEmptyOutput = false;
      let abortOnEmptyOutputStream = false;
      const emptyOutputStreams: string[] = [];
      let hasOutputFrames = false;
      let hasEmptyOutput = false;
      let progressTarget: string | undefined;
      let progressSeconds = 0;
      const progressStarted = performance.now();
      let progressFrames: number | undefined;
      const progressQuality: string[] = [];
      let progressSize: number | undefined;
      let inputReadFailed = false;
      let filterComplex: string | undefined;
      const mappedAudioLabels = new Set<string>();
      const audioOutputMaps = new Set<string>();
      const initializers: (() => Promise<{ exitCode: number } | void>)[] = [];
      const outputs: (() => Promise<{ exitCode: number }>)[] = [];
      const inputBytes = new Map<string, Uint8Array>();
      const readInput = async (path: string): Promise<Uint8Array> => {
        if (outputs.length === 1) return readSource(path);
        let bytes = inputBytes.get(path);
        if (!bytes) {
          bytes = await readSource(path);
          inputBytes.set(path, bytes);
        }
        // Each output may detach parsed buffers; retain the source for later outputs.
        return bytes.slice();
      };
      let i = 0;
      while (i < args.length) {
        let gifLoop = 0;
        let gifFlags = 3;
        let outputStartNumber: number | undefined;
        let updateImage = false;
        let strftime = false;
        let atomicWriting = false;
        let framePts = false;
        let encoderTimeBase: number | undefined;

        let outputFormat: string | undefined;
        let hashAlgorithm: string | undefined;
        let frameHashVersion = 2;
        let outputTimestampOffset = 0;
        let muxDelay: number | undefined;
        let avoidNegativeTs = "auto";
        let copyPriorStart = true;
        let outputSs: number | undefined;
        let outputTo: number | undefined;
        let outputDuration: number | undefined;
        let videoTag: string | undefined;
        let videoBitstreamFilter: string | undefined;
        let audioBitstreamFilter: string | undefined;
        let subtitleBitstreamFilter: string | undefined;
        let videoCodec: string | undefined;
        let videoQp: number | undefined;
        let zeroLatency = false;
        let maxBFrames: number | undefined;
        let videoPreset: string | undefined;
        let forceKeyFrames: number[] | undefined;
        let crf: number | undefined;
        let rawPixelFormat: string | undefined;
        let audioCodec: string | undefined;
        let audioBitrate: number | undefined;
        let videoBitrate: number | undefined;
        let subtitleCodec: string | undefined;
        let kaiserBeta = 9;
        let filterType: "kaiser" | "blackman_nuttall" = "kaiser";
        let audioRate: number | undefined;
        let audioChannelOptions: [string, number | undefined][] = [];
        let rematrixMaxval: number | undefined;
        let resampler: "swr" | "soxr" = "swr";
        let filterSize = 32;
        let phaseShift = 10;
        let linearInterp = 1;
        let exactRational = 1;
        let resampleCutoff = 0;
        let rematrixVolume = 1;
        let centerMixLevel: number | undefined;
        let surroundMixLevel: number | undefined;
        let lfeMixLevel: number | undefined;
        let individualHeaderTrailer = true;
        let writeHeaderTrailer = true;
        let segmentTime = 2;
        let writeEmptySegments = false;
        let segmentTimeDelta = 0;
        let segmentStartNumber = 0;
        let minSegmentDuration = 0;
        let segmentWrap = 0;
        let segmentTimes: number[] | undefined;
        let segmentFormat: string | undefined;
        let resetTimestamps = false;
        let initialOffset = 0;
        let segmentFrames: number[] | undefined;
        let segmentList: string | undefined;
        let segmentHeaderFilename: string | undefined;
        let segmentListEntryPrefix = "";
        let segmentListSize = 0;
        let segmentListType: "flat" | "csv" | undefined;
        let hlsFlags: string | undefined;
        let hlsTime = 2;
        let hlsInitTime = 0;
        let dashTargetLatency = 0;
        let dashWritePrft: boolean | undefined;
        let dashUtcTimingUrl: string | undefined;
        let dashMpdProfile: string | undefined;
        let dashAdaptationSets: string | undefined;
        let dashSegmentDuration = 5;
        let dashSegmentType: "auto" | "mp4" | "webm" = "auto";
        let dashFragmentType: "none" | "every_frame" | "duration" = "none";
        let dashStreaming = false;
        let dashLowLatency = false;
        let dashMinPlaybackRate = 1;
        let dashMaxPlaybackRate = 1;
        let dashWindowSize = 0;
        let dashUseTemplate = true;
        let dashSingleFile = false;
        let dashHlsPlaylist = false;
        let dashRemoveAtExit = false;
        let dashUseTimeline = true;
        let dashInitSegmentName: string | undefined;
        let dashMediaSegmentName: string | undefined;
        let hlsMasterName: string | undefined;
        let hlsListSize = 5;
        let hlsStartNumberSource = "generic";
        let hlsAllowCache = -1;
        let hlsPlaylistType: string | undefined;
        let hlsDeleteSegments = false;
        let hlsOmitEndlist = false;
        let hlsDiscontStart = false;
        let hlsAppendList = false;
        let hlsRoundDurations = false;
        let hlsProgramDateTime = false;
        let hlsIframesOnly = false;
        let hlsIndependentSegments = false;
        let hlsSplitByTime = false;
        let hlsDeleteThreshold = 1;
        let hlsBaseUrl = "";
        let hlsSegmentFilename: string | undefined;
        let hlsFmp4InitFilename = "init.mp4";
        let hlsSingleFile = false;
        let hlsTempFile = false;
        let hlsSegmentSize = 0;
        let hlsSecondLevelSegmentIndex = false;
        let hlsSegmentType: string | undefined;
        let stripAudio = false;
        let stripVideo = false;
        let stripSubtitles = false;
        let stripData = false;
        let shortest = false;
        let writeHeader = true;
        let writeXing = true;
        let writeBext = false;
        let patPeriod: number | undefined;
        let muxRate: number | undefined;
        let pcrPeriod: number | undefined;
        let writeCrc32 = true;
        let live = false;
        let writeTmcd = true;
        let sampleFormat: string | undefined;
        let trellis: number | undefined;
        let blockSize: number | undefined;
        let frameSize: number | undefined;
        let channelMode: string | undefined;
        let lpcType: string | undefined;
        let lpcPasses: number | undefined;
        let lpcCoeffPrecision: number | undefined;
        let minPartitionOrder: number | undefined;
        let maxPartitionOrder: number | undefined;
        let exactRiceParameters: number | undefined;
        let minPredictionOrder: number | undefined;
        let maxPredictionOrder: number | undefined;
        let predictionOrderMethod: string | undefined;
        let multiDimQuant: number | undefined;
        let compressionLevel: number | undefined;
        let peakBlockSize: number | undefined;
    let peakFormat: number | undefined;
    let peakPpv: number | undefined;
    let writePeak: "off" | "on" | "only" | undefined;
        let rf64: "always" | "auto" | "never" | undefined;
        let writeColr = false;
        let useMetadataTags = false;
        let disableChpl = false;
        let faststart = false;
        let majorBrand: string | undefined;
        let movieTimescale: number | undefined;
        let videoTrackTimescale = 0;
        let skipTrailer = false;
        let defaultBaseMoof = false;
        let segmentIndex: "global" | "fragment" | undefined;
        let mpegtsFlags = 0;
        let mpegtsTablesVersion: number | undefined;
        let omitVideoPesLength = true;
        let mpegtsServiceType: number | undefined;
        let fragmented = false;
        let fragmentKeyframes = false;
        let fragmentEveryFrame = false;
        let fragmentDuration: number | undefined;
        let fragmentDurationArg: string | undefined;
        let fragmentIndex: number | undefined;
        let emptyMoov = false;
        let writeApetag: boolean | undefined;
        let writeId3v2: boolean | undefined;
        let mpegtsStartPid: number | undefined;
        let pesPayloadSize: number | undefined;
        let writeMpeg2: boolean | undefined;
        let id3v2Version: 0 | 3 | 4 | undefined;
        let writeId3v1: boolean | undefined;
        let metadataHeaderPadding: number | undefined;
        let reserveIndexSpace: number | undefined;
        let cuesToFront: boolean | undefined;
        let clusterTimeLimit: number | undefined;
        let pageDuration: number | undefined;
        let apngPlays = 1;
        let finalDelay: number | undefined;
        let rle: boolean | undefined;
        let globalPalette: boolean | undefined;
        let mpegtsServiceId: number | undefined;
        let serialOffset: number | undefined;
        let bitexact = false;
        let autobsf = true;
        let maxVideoFrames: number | undefined;
        let maxAudioFrames: number | undefined;
        let fileSize: number | undefined;
        let maxSubtitleFrames: number | undefined;
        const frameLimits: [string, number][] = [];
        let outputFps: number | undefined;
        let videoSync = "auto";
        let outputSize: string | undefined;
        const maps: string[] = [];
        const streamIds = new Map<number, number>();
        let useStreamIdsAsTrackIds = false;
        const vfFilters: string[] = [];
        let logLevel = 32;
        const afFilters: { ordinal: number | undefined; expression: string }[] = [];
        let chapterSource: number | undefined;
        const metadataSources: number[] = [];
        const streamMetadataMaps: [string, string][] = [];
        const metadata: Record<string, string> = {};
        const streamMetadata: [string, "language" | "handlerName" | "timecode" | "title" | "comment" | "stereo_mode", string][] = [];
        const attachmentFiles: string[] = [];
        const attachmentMetadata: [string, string, string][] = [];
        const streamDispositions: [string, string][] = [];
        let defaultMode = "passthrough";
        const displayAspects: [string, number][] = [];
        const outputColors: OutputColorOption[] = [];
        let outputTarget: string | undefined;

        for (; i < args.length; i++) {
          const arg = args[i]!;
          if (arg === "-y" || arg === "-n") {
            if (overwrite !== undefined && overwrite !== (arg === "-y")) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: both -y and -n supplied\n"), context.signal);
              return { exitCode: 234 };
            }
            overwrite = arg === "-y";
          } else if (arg === "-progress") {
            progressTarget = args[++i];
          } else if (arg === "-abort_on") {
            const value = args[++i];
            let mask = 0;
            for (const flag of (value ?? "").split("+")) {
              if (flag === "empty_output") mask |= 1;
              else if (flag === "empty_output_stream") mask |= 2;
              else if (["0", "1", "2", "3"].includes(flag)) mask |= Number(flag);
              else { mask = -1; break; }
            }
            if (mask < 0) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Unsupported -abort_on value '${value ?? ""}'\n`), context.signal);
              return { exitCode: 234 };
            }
            abortOnEmptyOutput = (mask & 1) !== 0;
            abortOnEmptyOutputStream = (mask & 2) !== 0;
          } else if (arg === "-max_error_rate") {
            const value = args[++i]?.trim().toLowerCase() ?? "";
            const rate = ["inf", "+inf", "infinity", "+infinity"].includes(value) ? Infinity
              : value === "-inf" || value === "-infinity" ? -Infinity : Number(value);
            if (!value || (Number.isNaN(rate) && value !== "nan")) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Expected number for max_error_rate but found: ${value}\n`), context.signal);
              return { exitCode: 234 };
            }
            maxErrorRate = Math.fround(rate);
          } else if (arg === "-xerror") {
            exitOnError = true;
          } else if (arg === "-allowed_extensions") {
            pendingAllowedExtensions = args[++i];
            if (pendingAllowedExtensions === undefined) throw new Error("Missing value for -allowed_extensions");
          } else if (arg === "-segment_time_metadata") {
            const value = args[++i];
            if (value !== "0" && value !== "1") throw new Error("-segment_time_metadata requires 0 or 1");
            pendingSegmentTimeMetadata = value === "1";
          } else if (arg === "-auto_convert") {
            const value = args[++i];
            if (value !== "0" && value !== "1") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -auto_convert must be 0 or 1\n"), context.signal);
              return { exitCode: 1 };
            }
            pendingAutoConvert = value === "1";
          } else if (arg === "-safe") {
            const value = args[++i];
            if (value !== "0" && value !== "1") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -safe must be 0 or 1\n"), context.signal);
              return { exitCode: 1 };
            }
            pendingSafe = value === "1";
          } else if (arg === "-v" || arg === "-loglevel") {
            const value = args[++i]?.split("+").at(-1) ?? "";
            const levels: Record<string, number> = { quiet: -8, panic: 0, fatal: 8, error: 16, warning: 24, info: 32, verbose: 40, debug: 48, trace: 56 };
            logLevel = levels[value] ?? Number(value);
          } else if (arg === "-pix_fmt" || arg === "-pixel_format") {
            const value = args[++i];
            if (args.slice(i + 1).includes("-i")) pendingPixelFormat = value;
            else rawPixelFormat = value;
          } else if (arg === "-tag:v") {
            videoTag = args[++i];
            if (videoTag === undefined) throw new Error("Missing value for -tag:v");
          } else if (arg === "-bsf" || arg.startsWith("-bsf:")) {
            try {
              if (arg === "-bsf:a") {
                audioBitstreamFilter = args[++i];
                filterBitstream([], audioBitstreamFilter ?? "", budget, "audio");
              } else if (arg === "-bsf:v") {
                videoBitstreamFilter = args[++i];
                filterBitstream([], videoBitstreamFilter ?? "", budget);
              } else if (arg === "-bsf:s") {
                subtitleBitstreamFilter = args[++i];
                filterBitstream([], subtitleBitstreamFilter ?? "", budget, "subtitle");
              } else validateBitstreamFilters(args[++i]);
            } catch (error) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${(error as Error).message}\n`), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-qp") {
            const value = args[++i] ?? "";
            const qp = value.trim() ? Number(value) : NaN;
            if (!Number.isInteger(qp) || qp < -1 || qp > 51) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Invalid value for -qp: ${value}\n`), context.signal);
              return { exitCode: 234 };
            }
            videoQp = qp === -1 ? undefined : qp;
          } else if (arg === "-crf") {
            const value = args[++i];
            crf = Number(value);
            if (!value?.trim() || !Number.isFinite(crf) || crf < 0 || crf > 51) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Invalid CRF: expected a number from 0 to 51\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-threads" || arg === "-tag:a") {
            i++;
          } else if (arg === "-bf") {
            const value = args[++i];
            maxBFrames = value?.trim() ? Number(value) : NaN;
            if (!Number.isInteger(maxBFrames) || maxBFrames < -1 || maxBFrames > 2147483647) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Invalid B-frame count\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-tune") {
            const tune = args[++i];
            if (tune !== "zerolatency") {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Unsupported tune '${tune ?? ""}'\n`), context.signal);
              return { exitCode: 1 };
            }
            zeroLatency = true;
          } else if (arg === "-preset" || arg === "-preset:v" || arg === "-preset:v:0") {
            videoPreset = args[++i];
            if (videoPreset === undefined) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Missing value for ${arg}\n`), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-b:v") {
            videoBitrate = parseBitrate(args[++i]);
            if (videoBitrate === undefined) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Invalid video bitrate\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-b:a") {
            audioBitrate = parseBitrate(args[++i]);
            if (audioBitrate === undefined) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Invalid audio bitrate\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-format_version") {
            const value = args[++i];
            frameHashVersion = value?.trim() ? Number(value) : NaN;
            if (frameHashVersion !== 1 && frameHashVersion !== 2) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Invalid format_version: expected 1 or 2\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-hash") {
            hashAlgorithm = args[++i] ?? "";
          } else if (arg === "-update" || arg === "-atomic_writing" || arg === "-strftime" || arg === "-reset_timestamps" || arg === "-write_empty_segments") {
            let enabled: boolean;
            const value = args[++i]?.toLowerCase();
            if (value !== undefined && ["yes", "true", "on", "y", "enable", "enabled"].includes(value)) {
              enabled = true;
            } else if (value !== undefined && ["no", "false", "off", "n", "disable", "disabled", ""].includes(value)) {
              enabled = false;
            } else {
              const number = value?.trimStart() ?? "";
              const digits = number.startsWith("+") || number.startsWith("-") ? number.slice(1) : number;
              if (!digits.length || ![...digits].every(char => char >= "0" && char <= "9") ||
                  (Number(number) !== 0 && Number(number) !== 1)) {
                await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Invalid boolean value for ${arg}: ${value ?? ""}\n`), context.signal);
                return { exitCode: 234 };
              }
              enabled = Number(number) === 1;
            }
            if (arg === "-update") updateImage = enabled;
            else if (arg === "-strftime") strftime = enabled;
            else if (arg === "-reset_timestamps") resetTimestamps = enabled;
            else if (arg === "-write_empty_segments") writeEmptySegments = enabled;
            else atomicWriting = enabled;
          } else if (["-enc_time_base", "-enc_time_base:v", "-enc_time_base:v:0", "-enc_time_base:V", "-enc_time_base:V:0", "-enc_time_base:0"].includes(arg)) {
            const value = args[++i] ?? "";
            const parts = value.split(value.includes(":") ? ":" : "/");
            const numerator = Number(parts[0]);
            const denominator = parts.length === 1 ? 1 : Number(parts[1]);
            const timeBase = numerator / denominator;
            if (parts.length > 2 || parts.some(part => !part.trim()) ||
                !Number.isFinite(timeBase) || numerator < 0 || denominator <= 0) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Invalid value for -enc_time_base: ${value}\n`), context.signal);
              return { exitCode: 234 };
            }
            encoderTimeBase = timeBase === 0 ? undefined : timeBase;
          } else if (arg === "-vsync") {
            const value = args[++i] ?? "";
            const mode = value.toLowerCase();
            if (["passthrough", "cfr", "vfr", "drop"].includes(mode)) {
              videoSync = mode;
            } else {
              const number = value.trim() ? Number(value) : NaN;
              if (!Number.isInteger(number) || number < -1 || number > 2) {
                await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Invalid value for -vsync: ${value}\n`), context.signal);
                return { exitCode: 234 };
              }
              videoSync = String(number);
            }
          } else if (["-fps_mode", "-fps_mode:v", "-fps_mode:v:0", "-fps_mode:V", "-fps_mode:V:0", "-fps_mode:0"].includes(arg)) {
            videoSync = (args[++i] ?? "").toLowerCase();
            if (!["passthrough", "cfr", "vfr", "auto", "drop"].includes(videoSync)) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Invalid value for -fps_mode: ${videoSync}\n`), context.signal);
              return { exitCode: 234 };
            }
          } else if (arg === "-individual_header_trailer") {
            const value = args[++i];
            if (value !== "0" && value !== "1") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid individual_header_trailer value: expected 0 or 1\n"), context.signal);
              return { exitCode: 1 };
            }
            individualHeaderTrailer = value === "1";
          } else if (arg === "-write_header_trailer") {
            const value = args[++i];
            if (value !== "0" && value !== "1") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid write_header_trailer value: expected 0 or 1\n"), context.signal);
              return { exitCode: 1 };
            }
            writeHeaderTrailer = value === "1";
          } else if (arg === "-segment_start_number") {
            const value = args[++i];
            segmentStartNumber = value?.trim() ? Number(value) : NaN;
            if (!Number.isInteger(segmentStartNumber) || segmentStartNumber < 0 || segmentStartNumber > 2147483647) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -segment_start_number requires an integer from 0 to 2147483647\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-segment_format") {
            segmentFormat = args[++i];
            if (!segmentFormat) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: missing segment_format value\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-segment_time") {
            const value = args[++i];
            segmentTime = parseHlsDuration(value ?? "");
            if (!Number.isFinite(segmentTime) || segmentTime < 0) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid segment_time\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-min_seg_duration") {
            minSegmentDuration = parseHlsDuration(args[++i] ?? "");
            if (!Number.isFinite(minSegmentDuration) || minSegmentDuration < 0 || minSegmentDuration > 9_223_372_036_854.775) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid min_seg_duration\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-segment_wrap") {
            const value = args[++i] ?? "";
            segmentWrap = Number(value);
            if (!value.trim() || !Number.isInteger(segmentWrap) || segmentWrap < 0 || segmentWrap > 2147483647) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid segment_wrap\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-initial_offset") {
            initialOffset = parseHlsDuration(args[++i] ?? "");
            if (!Number.isFinite(initialOffset)) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid initial_offset\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-segment_time_delta") {
            segmentTimeDelta = parseHlsDuration(args[++i] ?? "");
            if (!Number.isFinite(segmentTimeDelta) || segmentTimeDelta < 0) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid segment_time_delta\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-segment_frames") {
            const values = (args[++i] ?? "").split(",");
            segmentFrames = values.map(value => Number(value));
            if (values.some((value, index) => !value.trim() ||
                !Array.from(value.trim()).every(char => char >= "0" && char <= "9") ||
                !Number.isInteger(segmentFrames![index]) || segmentFrames![index]! > 2147483647 ||
                (index > 0 && segmentFrames![index]! < segmentFrames![index - 1]!))) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid segment_frames\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-segment_times") {
            segmentTimes = (args[++i] ?? "").split(",").map(parseHlsDuration);
            if (segmentTimes.some((time, index) => !Number.isFinite(time) || time < 0 ||
              (index > 0 && time < segmentTimes![index - 1]!))) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid segment_times\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-segment_list_type") {
            const value = args[++i];
            if (value !== "flat" && value !== "csv") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid segment_list_type (expected flat or csv)\n"), context.signal);
              return { exitCode: 1 };
            }
            segmentListType = value;
          } else if (arg === "-segment_list_size") {
            const value = args[++i];
            segmentListSize = value?.trim() ? Number(value) : NaN;
            if (!Number.isInteger(segmentListSize) || segmentListSize < 0 || segmentListSize > 2147483647) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid segment_list_size\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-segment_list_entry_prefix") {
            const value = args[++i];
            if (value === undefined) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: missing segment_list_entry_prefix value\n"), context.signal);
              return { exitCode: 1 };
            }
            segmentListEntryPrefix = value;
          } else if (arg === "-segment_header_filename") {
            segmentHeaderFilename = args[++i];
            if (!segmentHeaderFilename) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: missing segment_header_filename value\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-segment_list") {
            segmentList = args[++i];
            if (!segmentList) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: missing segment_list filename\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-hls_time" || arg === "-hls_init_time") {
            const value = parseHlsDuration(args[++i] ?? "");
            if (arg === "-hls_time") hlsTime = value;
            else hlsInitTime = value;
            if (i >= args.length) break;
          } else if (arg === "-adaptation_sets") {
            dashAdaptationSets = args[++i];
            if (!dashAdaptationSets || dashAdaptationSets.startsWith("-")) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: missing adaptation_sets mapping\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-init_seg_name" || arg === "-media_seg_name") {
            const value = args[++i];
            if (!value) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: missing ${arg.slice(1)} filename\n`), context.signal);
              return { exitCode: 1 };
            }
            if (arg === "-init_seg_name") dashInitSegmentName = value;
            else dashMediaSegmentName = value;
          } else if (arg === "-use_template" || arg === "-use_timeline" || arg === "-single_file" || arg === "-remove_at_exit" || arg === "-hls_playlist" || arg === "-streaming" || arg === "-ldash") {
            const value = args[++i];
            if (value !== "0" && value !== "1") {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: invalid ${arg.slice(1)}\n`), context.signal);
              return { exitCode: 1 };
            }
            if (arg === "-use_template") dashUseTemplate = value === "1";
            else if (arg === "-use_timeline") dashUseTimeline = value === "1";
            else if (arg === "-single_file") dashSingleFile = value === "1";
            else if (arg === "-hls_playlist") dashHlsPlaylist = value === "1";
            else if (arg === "-streaming") dashStreaming = value === "1";
            else if (arg === "-ldash") dashLowLatency = value === "1";
            else dashRemoveAtExit = value === "1";
          } else if (arg === "-min_playback_rate" || arg === "-max_playback_rate") {
            const rate = parseFrameRate(args[++i] ?? "");
            if (rate === undefined || rate < 0.5 || rate > 1.5) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: invalid ${arg.slice(1)}\n`), context.signal);
              return { exitCode: 234 };
            }
            if (arg === "-min_playback_rate") dashMinPlaybackRate = rate;
            else dashMaxPlaybackRate = rate;
          } else if (arg === "-write_prft") {
            const value = args[++i];
            if (value !== "0" && value !== "1" && !(arg === "-write_prft" && value === "-1")) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: invalid ${arg.slice(1)}\n`), context.signal);
              return { exitCode: 1 };
            }
            dashWritePrft = value === "-1" ? undefined : value === "1";
          } else if (arg === "-utc_timing_url") {
            dashUtcTimingUrl = args[++i];
            if (dashUtcTimingUrl === undefined) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: missing utc_timing_url\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-target_latency") {
            dashTargetLatency = parseHlsDuration(args[++i] ?? "");
            if (!Number.isFinite(dashTargetLatency) || dashTargetLatency < 0 || dashTargetLatency > 9_223_372_036_854.775) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid target_latency\n"), context.signal);
              return { exitCode: 234 };
            }
          } else if (arg === "-window_size") {
            const value = args[++i] ?? "";
            dashWindowSize = Number(value);
            if (!value.trim() || !Number.isInteger(dashWindowSize) || dashWindowSize < 0 || dashWindowSize > 2_147_483_647) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid window_size\n"), context.signal);
              return { exitCode: 234 };
            }
          } else if (arg === "-dash_segment_type") {
            const value = args[++i];
            if (value === "auto" || value === "0") dashSegmentType = "auto";
            else if (value === "mp4" || value === "1") dashSegmentType = "mp4";
            else if (value === "webm" || value === "2") dashSegmentType = "webm";
            else {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid dash_segment_type (expected auto, mp4 or webm)\n"), context.signal);
              return { exitCode: 234 };
            }
          } else if (arg === "-frag_type") {
            const value = args[++i];
            if (value !== "none" && value !== "every_frame" && value !== "duration") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: unsupported frag_type (expected none, every_frame or duration)\n"), context.signal);
              return { exitCode: 234 };
            }
            dashFragmentType = value;
          } else if (arg === "-mpd_profile") {
            dashMpdProfile = args[++i];
            if (!dashMpdProfile || dashMpdProfile.split("+").some(profile => profile !== "dash" && profile !== "dvb_dash")) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid mpd_profile\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-seg_duration") {
            dashSegmentDuration = parseHlsDuration(args[++i] ?? "");
            if (!Number.isFinite(dashSegmentDuration) || dashSegmentDuration < 0 || dashSegmentDuration > 9_223_372_036_854.775) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid seg_duration\n"), context.signal);
              return { exitCode: 234 };
            }
          } else if (arg === "-hls_base_url") {
            const value = args[++i];
            if (value === undefined) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: missing hls_base_url\n"), context.signal);
              return { exitCode: 1 };
            }
            hlsBaseUrl = value;
          } else if (arg === "-hls_fmp4_init_filename") {
            const value = args[++i];
            if (!value) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: missing hls_fmp4_init_filename\n"), context.signal);
              return { exitCode: 1 };
            }
            hlsFmp4InitFilename = value;
          } else if (arg === "-hls_segment_filename") {
            hlsSegmentFilename = args[++i];
          } else if (arg === "-hls_segment_size") {
            const value = args[++i];
            hlsSegmentSize = value?.trim() ? Number(value) : NaN;
            if (!Number.isInteger(hlsSegmentSize) || hlsSegmentSize < 0 || hlsSegmentSize > 2147483647) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid hls_segment_size\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-hls_segment_type") {
            hlsSegmentType = args[++i] ?? "";
            if (i >= args.length) break;
          } else if (arg === "-hls_playlist_type") {
            hlsPlaylistType = args[++i] ?? "";
            if (i >= args.length) break;
          } else if (arg === "-hls_allow_cache") {
            const value = args[++i];
            hlsAllowCache = value?.trim() ? Number(value) : NaN;
            if (!Number.isInteger(hlsAllowCache) || hlsAllowCache < -2147483648 || hlsAllowCache > 2147483647) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid hls_allow_cache\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-hls_start_number_source") {
            const value = args[++i];
            if (value !== "generic" && value !== "epoch" && value !== "epoch_us" && value !== "datetime") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid hls_start_number_source\n"), context.signal);
              return { exitCode: 1 };
            }
            hlsStartNumberSource = value;
          } else if (arg === "-master_pl_name") {
            hlsMasterName = args[++i];
            if (!hlsMasterName) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: missing master_pl_name\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-hls_list_size") {
            const value = args[++i];
            try {
              hlsListSize = parseFilterExpression(value ?? "", "hls_list_size", {});
            } catch {
              hlsListSize = NaN;
            }
            if (i >= args.length) break;
          } else if (arg === "-hls_flags") {
            const value = args[++i] ?? "";
            hlsFlags = value.startsWith("+") || value.startsWith("-") ? (hlsFlags ?? "") + value : value;
            if (i >= args.length) break;
          } else if (arg === "-hls_delete_threshold") {
            const value = args[++i];
            hlsDeleteThreshold = value?.trim() ? Number(value) : NaN;
            if (i >= args.length) break;
          } else if (arg === "-map_chapters") {
            const value = args[++i];
            chapterSource = value?.trim() ? Number(value) : NaN;
            if (!Number.isSafeInteger(chapterSource)) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid chapter input index\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-map_metadata:s" || arg.startsWith("-map_metadata:s:")) {
            streamMetadataMaps.push([arg.slice("-map_metadata:s:".length), args[++i] ?? ""]);
          } else if (arg === "-map_metadata" || arg === "-map_metadata:g") {
            const source = args[++i];
            const value = source?.endsWith(":g") ? source.slice(0, -2) : source;
            const metadataSource = value?.trim() ? Number(value) : NaN;
            if (!Number.isSafeInteger(metadataSource)) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid metadata input index\n"), context.signal);
              return { exitCode: 1 };
            }
            metadataSources.push(metadataSource);
          } else if (arg === "-frame_pts") {
            const value = args[++i]?.toLowerCase();
            if (value !== undefined && ["yes", "true", "on", "y", "enable", "enabled"].includes(value)) {
              framePts = true;
            } else if (value !== undefined && ["no", "false", "off", "n", "disable", "disabled", ""].includes(value)) {
              framePts = false;
            } else {
              const number = value?.trimStart() ?? "";
              const digits = number.startsWith("+") || number.startsWith("-") ? number.slice(1) : number;
              if (!digits.length || ![...digits].every(char => char >= "0" && char <= "9") ||
                  (Number(number) !== 0 && Number(number) !== 1)) {
                await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid frame_pts\n"), context.signal);
                return { exitCode: 1 };
              }
              framePts = Number(number) === 1;
            }
          } else if (arg === "-start_number_range") {
            const value = Number(args[++i]);
            if (!Number.isInteger(value) || value < 1 || value > 2147483647) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid start_number_range\n"), context.signal);
              return { exitCode: 1 };
            }
            pendingStartNumberRange = value;
          } else if (arg === "-start_number") {
            const val = Number(args[++i]);
            const isInput = args.slice(i + 1).includes("-i");
            if (!Number.isSafeInteger(val) || (isInput ? val < -2147483648 || val > 2147483647 : val < 0)) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid start_number\n"), context.signal);
              return { exitCode: 1 };
            }
            if (isInput) pendingStartNumber = val;
            else outputStartNumber = val;
          } else if (arg === "-resampler") {
            const raw = args[++i];
            if (raw === "swr" || raw === "0") resampler = "swr";
            else if (raw === "soxr" || raw === "1") resampler = "soxr";
            else {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: resampler must be swr or soxr\n"), context.signal);
              return { exitCode: 8 };
            }
          } else if (arg === "-kaiser_beta") {
            const raw = args[++i];
            kaiserBeta = Number(raw);
            if (!raw?.trim() || !Number.isFinite(kaiserBeta) || kaiserBeta < 2 || kaiserBeta > 16) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: kaiser_beta must be a number between 2 and 16\n"), context.signal);
              return { exitCode: 8 };
            }
          } else if (arg === "-filter_type") {
            const raw = args[++i];
            if (raw !== "kaiser" && raw !== "blackman_nuttall") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: filter_type must be kaiser or blackman_nuttall\n"), context.signal);
              return { exitCode: 8 };
            }
            filterType = raw;
          } else if (arg === "-ar" || (arg === "-sample_rate" && args.slice(i + 1).includes("-i"))) {
            audioRate = parseInt(args[++i] ?? "0", 10) || undefined;
            if (audioRate !== undefined && audioRate < 0) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: sample rate must be nonnegative\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-resample_cutoff") {
            const raw = args[++i];
            resampleCutoff = Number(raw);
            if (!raw?.trim() || !Number.isFinite(resampleCutoff) || resampleCutoff < 0 || resampleCutoff > 1) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: resample_cutoff must be a number between 0 and 1\n"), context.signal);
              return { exitCode: 8 };
            }
          } else if (arg === "-cutoff") {
            // FFmpeg routes this CLI option to the encoder, not swresample.
            const raw = args[++i];
            const cutoff = Number(raw);
            if (!raw?.trim() || !Number.isFinite(cutoff) || cutoff < -2147483648 || cutoff > 2147483647) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid codec cutoff\n"), context.signal);
              return { exitCode: 8 };
            }
          } else if (arg === "-exact_rational") {
            const raw = args[++i];
            exactRational = Number(raw);
            if (!raw?.trim() || (exactRational !== 0 && exactRational !== 1)) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: exact_rational must be 0 or 1\n"), context.signal);
              return { exitCode: 8 };
            }
          } else if (arg === "-linear_interp") {
            const raw = args[++i];
            linearInterp = Number(raw);
            if (!raw?.trim() || (linearInterp !== 0 && linearInterp !== 1)) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: linear_interp must be 0 or 1\n"), context.signal);
              return { exitCode: 8 };
            }
          } else if (arg === "-phase_shift") {
            const raw = args[++i];
            phaseShift = Number(raw);
            if (!raw?.trim() || !Number.isInteger(phaseShift) || phaseShift < 0 || phaseShift > 24) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: phase_shift must be an integer between 0 and 24\n"), context.signal);
              return { exitCode: 8 };
            }
          } else if (arg === "-swr_flags") {
            const raw = args[++i];
            if (raw !== "res") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: swr_flags must be res\n"), context.signal);
              return { exitCode: 8 };
            }
            // This CLI option does not force an equal-rate PCM conversion through resampling.
          } else if (arg === "-filter_size") {
            const raw = args[++i];
            filterSize = Number(raw);
            if (!raw?.trim() || !Number.isInteger(filterSize) || filterSize < 0 || filterSize > 2147483647) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: filter_size must be an integer between 0 and 2147483647\n"), context.signal);
              return { exitCode: 8 };
            }
          } else if (arg === "-lfe_mix_level") {
            const raw = args[++i];
            lfeMixLevel = Number(raw);
            if (!raw?.trim() || !Number.isFinite(lfeMixLevel) || Math.abs(lfeMixLevel) > 32) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: lfe_mix_level must be a number between -32 and 32\n"), context.signal);
              return { exitCode: 8 };
            }
          } else if (arg === "-surround_mix_level") {
            const raw = args[++i];
            surroundMixLevel = Number(raw);
            if (!raw?.trim() || !Number.isFinite(surroundMixLevel) || Math.abs(surroundMixLevel) > 32) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: surround_mix_level must be a number between -32 and 32\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-rematrix_maxval") {
            const raw = args[++i];
            rematrixMaxval = Number(raw);
            if (!raw?.trim() || !Number.isFinite(rematrixMaxval) || rematrixMaxval < 0 || rematrixMaxval > 1000) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: rematrix_maxval must be a number between 0 and 1000\n"), context.signal);
              return { exitCode: 8 };
            }
          } else if (arg === "-rematrix_volume") {
            const raw = args[++i];
            rematrixVolume = Number(raw);
            if (!raw?.trim() || !Number.isFinite(rematrixVolume) || Math.abs(rematrixVolume) > 1000) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: rematrix_volume must be a number between -1000 and 1000\n"), context.signal);
              return { exitCode: 8 };
            }
          } else if (arg === "-center_mix_level") {
            const raw = args[++i];
            centerMixLevel = Number(raw);
            if (!raw?.trim() || !Number.isFinite(centerMixLevel) || Math.abs(centerMixLevel) > 32) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: center_mix_level must be a number between -32 and 32\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-ac" || arg.startsWith("-ac:")) {
            try {
              const value = args[++i];
              if (i < args.length) audioChannelOptions.push(parseAudioChannels(arg, value));
            } catch (error) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${(error as Error).message}\n`), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-guess_layout_max") {
            const value = args[++i];
            const threshold = value?.trim() ? Number(value) : NaN;
            if (!Number.isInteger(threshold) || threshold < -2147483648 || threshold > 2147483647 ||
                !args.slice(i + 1).includes("-i")) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -guess_layout_max requires a signed 32-bit integer before an input\n"), context.signal);
              return { exitCode: 1 };
            }
            pendingGuessLayoutMax = threshold;
          } else if (arg === "-ch_layout" || arg === "-channel_layout") {
            const layout = args[++i];
            const beforeInput = args.slice(i + 1).includes("-i");
            const channels = parseAudioChannelLayout(layout ?? "");
            const names = channels.join("+");
            if (beforeInput ? !["FC", "FL+FR", "FC+LFE", "FL+FR+BL+BR", "FL+FR+FC+LFE+BL+BR"].includes(names) : layout !== "mono") {
              await writeBytes(context.stderr, encodeUtf8(beforeInput
                ? `ffmpeg: unsupported input channel layout '${layout ?? ""}'\n`
                : "ffmpeg: only mono output channel layout is supported\n"), context.signal);
              return { exitCode: 1 };
            }
            audioChannelOptions.push(["", channels.length]);
            if (beforeInput) pendingChannelLayout = names;
          } else if (arg === "-hide_banner" || arg === "-nostdin" || arg === "-stats" || arg === "-nostats") {
            // no-op
          } else if (arg === "-f") {
            const val = args[++i];
            if (inputs.length === 0 || (i + 1 < args.length && args.slice(i + 1).includes("-i"))) {
              pendingFormat = val;
            } else {
              outputFormat = val;
            }
          } else if (arg === "-itsscale" || arg.startsWith("-itsscale:")) {
            const value = args[++i];
            try {
              if (!args.slice(i + 1).includes("-i")) throw new Error("-itsscale must precede an input");
              pendingTimestampScales.push(parseTimestampScale(arg, value));
            } catch (error) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${(error as Error).message}\n`), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-isync") {
            const value = args[++i];
            const reference = value?.trim() ? Number(value) : NaN;
            if (!Number.isInteger(reference) || reference < -1 || reference > 2147483647 || !args.slice(i + 1).includes("-i")) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Invalid -isync reference input\n"), context.signal);
              return { exitCode: 1 };
            }
            pendingSyncReference = reference;
          } else if (arg === "-copypriorss") {
            const value = args[++i];
            if (value !== "0" && value !== "1") throw new Error("Invalid copypriorss: expected 0 or 1");
            copyPriorStart = value === "1";
          } else if (arg === "-copyinkf") {
            copyInitialNonKeyframes = true;
          } else if (arg === "-avoid_negative_ts") {
            const value = args[++i] ?? "";
            const modes: Record<string, string> = { "-1": "auto", "0": "disabled", "1": "make_non_negative", "2": "make_zero" };
            avoidNegativeTs = modes[value] ?? value;
            if (!["auto", "disabled", "make_non_negative", "make_zero"].includes(avoidNegativeTs)) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Invalid avoid_negative_ts\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-muxdelay") {
            const value = args[++i];
            muxDelay = value?.trim() ? Number(value) : NaN;
            if (!Number.isFinite(muxDelay) || muxDelay < 0 || muxDelay > 2147.483647) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Invalid muxdelay: expected seconds from 0 to 2147.483647\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-copyts") {
            copyTimestamps = true;
          } else if (arg === "-start_at_zero") {
            startAtZero = true;
          } else if (arg === "-itsoffset" || arg === "-output_ts_offset") {
            const value = parseHlsDuration(args[++i] ?? "");
            const beforeInput = args.slice(i + 1).includes("-i");
            if (!Number.isFinite(value) || (arg === "-itsoffset" ? !beforeInput : beforeInput)) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: invalid ${arg} duration or placement\n`), context.signal);
              return { exitCode: 1 };
            }
            if (arg === "-itsoffset") pendingTimestampOffset = value;
            else outputTimestampOffset = value;
          } else if (arg === "-sseof") {
            const val = parseHlsDuration(args[++i] ?? "");
            if (!Number.isFinite(val) || val >= 0 || !args.slice(i + 1).includes("-i")) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -sseof requires a negative duration before an input\n"), context.signal);
              return { exitCode: 1 };
            }
            pendingSseof = val;
          } else if (arg === "-ss") {
            const val = parseHlsDuration(args[++i] ?? "");
            if (i < args.length && !Number.isFinite(val)) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid -ss duration\n"), context.signal);
              return { exitCode: 1 };
            }
            if (args.slice(i + 1).includes("-i")) {
              pendingSs = val;
            } else {
              outputSs = val;
            }
          } else if (arg === "-to") {
            const val = parseHlsDuration(args[++i] ?? "");
            if (i < args.length && !Number.isFinite(val)) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid -to duration\n"), context.signal);
              return { exitCode: 1 };
            }
            if (args.slice(i + 1).includes("-i")) {
              pendingTo = val;
            } else {
              outputTo = val;
            }
          } else if (arg === "-t") {
            const val = parseHlsDuration(args[++i] ?? "");
            if (i < args.length && (!Number.isFinite(val) || val < 0)) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -t duration must be nonnegative\n"), context.signal);
              return { exitCode: 1 };
            }
            if (args.slice(i + 1).includes("-i")) {
              pendingDuration = val;
            } else {
              outputDuration = val;
            }
          } else if (arg === "-pattern_type") {
            const selector = args[++i];
            const value = selector === "1" ? "glob" : selector === "2" ? "sequence" : selector === "3" ? "none" : selector;
            if (value !== "glob" && value !== "glob_sequence" && value !== "none" && value !== "sequence") {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Invalid image2 pattern type: ${value ?? ""}\n`), context.signal);
              return { exitCode: 1 };
            }
            pendingPatternType = value;
          } else if (arg === "-gifflags") {
            const value = args[++i] ?? "";
            let flags = value.startsWith("+") || value.startsWith("-") ? gifFlags : 0;
            let position = 0;
            let valid = value.length > 0;
            while (position < value.length) {
              const remove = value[position] === "-";
              if (value[position] === "+" || remove) position++;
              const start = position;
              while (position < value.length && value[position] !== "+" && value[position] !== "-") position++;
              const token = value.slice(start, position);
              const bits = token === "offsetting" ? 1 : token === "transdiff" ? 2 : token === "0" ? 0 : token === "1" ? 1 : token === "2" ? 2 : token === "3" ? 3 : -1;
              if (bits < 0) { valid = false; break; }
              flags = remove ? flags & ~bits : flags | bits;
            }
            if (!valid) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Invalid -gifflags value\n"), context.signal);
              return { exitCode: 1 };
            }
            gifFlags = flags;
          } else if (arg === "-min_delay" || arg === "-default_delay" || arg === "-max_gif_delay") {
            const value = args[++i];
            const delay = value?.trim() ? Number(value) : NaN;
            const max = arg === "-max_gif_delay" ? 65535 : 6000;
            if (!Number.isInteger(delay) || delay < 0 || delay > max || !args.slice(i + 1).includes("-i")) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${arg} requires an integer from 0 to ${max} before an input\n`), context.signal);
              return { exitCode: 1 };
            }
            // Native GIF decoding uses embedded frame delays, independently of
            // these demuxer timing options. Keep the decoded frame timeline.
          } else if (arg === "-ignore_loop") {
            const value = args[++i];
            if ((value !== "0" && value !== "1") || !args.slice(i + 1).includes("-i")) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -ignore_loop requires 0 or 1 before an input\n"), context.signal);
              return { exitCode: 1 };
            }
            pendingIgnoreLoop = value === "1";
          } else if (arg === "-loop") {
            const value = args[++i];
            if (args.slice(i + 1).includes("-i")) {
              if (value !== "0" && value !== "1") {
                await writeBytes(context.stderr, encodeUtf8("ffmpeg: input -loop must be 0 or 1\n"), context.signal);
                return { exitCode: 1 };
              }
              pendingImageLoop = value === "1";
            } else {
              gifLoop = value?.trim() ? Number(value) : NaN;
              if (!Number.isInteger(gifLoop) || gifLoop < -1 || gifLoop > 65535) {
                await writeBytes(context.stderr, encodeUtf8("ffmpeg: output -loop must be an integer from -1 to 65535\n"), context.signal);
                return { exitCode: 1 };
              }
            }
          } else if (arg === "-stream_loop") {
            pendingLoop = parseInt(args[++i] ?? "0", 10) || 0;
          } else if (arg === "-kind") {
            pendingWebvttKind = args[++i];
            if (!["subtitles", "captions", "descriptions", "metadata"].includes(pendingWebvttKind ?? "") || !args.slice(i + 1).includes("-i")) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -kind requires subtitles, captions, descriptions or metadata before an input\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-sub_charenc") {
            pendingSubtitleCharset = args[++i];
            if (!pendingSubtitleCharset || !args.slice(i + 1).includes("-i")) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -sub_charenc requires a charset before an input\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-sub_charenc_mode") {
            pendingSubtitleCharencMode = args[++i];
            if (!["ignore", "do_nothing", "auto", "pre_decoder"].includes(pendingSubtitleCharencMode ?? "") || !args.slice(i + 1).includes("-i")) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -sub_charenc_mode requires ignore, do_nothing, auto or pre_decoder before an input\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-subfps") {
            pendingSubtitleFrameRate = parseFrameRate(args[++i] ?? "");
            if (pendingSubtitleFrameRate === undefined || !args.slice(i + 1).includes("-i")) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -subfps requires a positive frame rate before an input\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-r" || arg === "-framerate") {
            const val = parseFrameRate(args[++i] ?? "");
            if (val === undefined) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Invalid framerate\n"), context.signal);
              return { exitCode: 1 };
            }
            if (args.slice(i + 1).includes("-i")) {
              pendingFps = val;
            } else {
              outputFps = val;
            }
          } else if (arg === "-s" || arg === "-video_size") {
            const value = args[++i];
            if (args.slice(i + 1).includes("-i")) pendingVideoSize = value;
            else outputSize = value;
          } else if (arg === "-fix_sub_duration") {
            if (!args.slice(i + 1).includes("-i")) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -fix_sub_duration must precede an input\n"), context.signal);
              return { exitCode: 1 };
            }
            pendingFixSubDuration = true;
          } else if (arg === "-max_size") {
            const value = Number(args[++i]);
            if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff || !args.slice(i + 1).includes("-i")) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -max_size requires an integer from 0 to 2147483647 before an input\n"), context.signal);
              return { exitCode: 1 };
            }
            pendingMaxSize = value;
          } else if (arg === "-ignore_length") {
            const value = args[++i];
            if ((value !== "0" && value !== "1") || !args.slice(i + 1).includes("-i")) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -ignore_length requires 0 or 1 before an input\n"), context.signal);
              return { exitCode: 1 };
            }
            pendingIgnoreLength = value === "1";
          } else if (arg === "-skip_initial_bytes") {
            const value = Number(args[++i]);
            if (!Number.isSafeInteger(value) || value < 0 || !args.slice(i + 1).includes("-i")) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -skip_initial_bytes requires a nonnegative integer before an input\n"), context.signal);
              return { exitCode: 1 };
            }
            pendingSkipInitialBytes = value;
          } else if (arg === "-dump_attachment" || arg.startsWith("-dump_attachment:")) {
            const specifier = arg.slice("-dump_attachment:".length);
            const filename = args[++i];
            if (filename === undefined) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${arg} requires a filename\n`), context.signal);
              return { exitCode: 1 };
            }
            const parts = specifier.split(":");
            if (["v", "a", "s", "d", "t"].includes(parts[0]!)) parts.shift();
            if (parts.length > 1 || (parts[0] && !Array.from(parts[0]).every(char => char >= "0" && char <= "9"))) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Invalid stream specifier: ${specifier}\n`), context.signal);
              return { exitCode: 1 };
            }
            pendingDumpAttachments.push([specifier, filename]);
          } else if (arg === "-i") {
            if (pendingAudioDecoder !== undefined && !astPlugins.some(plugin => plugin.canDemux && plugin.supportedAudioCodecs.includes(pendingAudioDecoder!))) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Unknown decoder '${pendingAudioDecoder}'\n`), context.signal);
              return { exitCode: 1 };
            }
            pendingAudioDecoder = undefined;
            const inputPlugin = pendingFormat === undefined ? undefined : registry.findByFormatName(pendingFormat);
            if (pendingChannelLayout && pendingChannelLayout !== "FC" && pendingChannelLayout !== "FL+FR" &&
                inputPlugin?.supportedAudioCodecs.includes(`pcm_${inputPlugin.id}`)) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: only mono and stereo raw input channel layouts are supported\n"), context.signal);
              return { exitCode: 1 };
            }
            const path = args[++i] ?? "";
            inputs.push({
              guessLayoutMax: pendingChannelLayout ? undefined : pendingGuessLayoutMax,
              dumpAttachments: pendingDumpAttachments,
              path,
              format: pendingFormat,
              sampleRate: audioRate,
              channels: audioChannelsForStream(audioChannelOptions, 0, 0),
              subtitleFrameRate: pendingSubtitleFrameRate,
              subtitleCharencMode: pendingSubtitleCharencMode,
              subtitleCharset: pendingSubtitleCharset,
              webvttKind: pendingWebvttKind,
              fixSubDuration: pendingFixSubDuration,
              safe: pendingSafe,
              autoConvert: pendingAutoConvert,
              segmentTimeMetadata: pendingSegmentTimeMetadata,
              allowedExtensions: pendingAllowedExtensions,
              skipInitialBytes: pendingSkipInitialBytes,
              ignoreLength: pendingIgnoreLength,
              maxSize: pendingMaxSize,
              timestampOffset: pendingTimestampOffset,
              syncReference: pendingSyncReference,
              startSeconds: pendingSs,
              endRelativeSeconds: pendingSseof,
              timestampScales: pendingTimestampScales,
              displayTransforms: pendingDisplayTransforms,
              endSeconds: pendingTo,
              durationSeconds: pendingDuration,
              streamLoop: pendingLoop,
              ignoreLoop: pendingIgnoreLoop,
              imageLoop: pendingImageLoop,
              fps: pendingFps,
              videoSize: pendingVideoSize,
              pixelFormat: pendingPixelFormat,
              startNumber: pendingStartNumber,
              patternType: pendingPatternType,
              startNumberRange: pendingStartNumberRange
            });
            pendingDumpAttachments = [];
            pendingGuessLayoutMax = undefined;
            pendingChannelLayout = undefined;
            audioRate = undefined;
            audioChannelOptions = [];
            pendingFormat = undefined;
            pendingSafe = undefined;
            pendingAutoConvert = undefined;
            pendingSegmentTimeMetadata = undefined;
            pendingAllowedExtensions = undefined;
            pendingTimestampOffset = 0;
            pendingSyncReference = undefined;
            pendingSubtitleFrameRate = undefined;
            pendingSubtitleCharencMode = undefined;
            pendingSubtitleCharset = undefined;
            pendingWebvttKind = undefined;
            pendingFixSubDuration = false;
            pendingSkipInitialBytes = 0;
            pendingIgnoreLength = false;
            pendingMaxSize = undefined;
            pendingSs = undefined;
            pendingSseof = undefined;
            pendingTimestampScales = [];
            pendingDisplayTransforms = [];
            pendingTo = undefined;
            pendingDuration = undefined;
            pendingLoop = undefined;
            pendingIgnoreLoop = undefined;
            pendingImageLoop = undefined;
            pendingFps = undefined;
            pendingVideoSize = undefined;
            pendingPixelFormat = undefined;
            pendingStartNumber = undefined;
            pendingStartNumberRange = undefined;
            pendingPatternType = undefined;
          } else if (arg === "-c" || arg === "-codec") {
            const val = args[++i];
            videoCodec = val;
            audioCodec = val;
            subtitleCodec = val;
          } else if (arg === "-force_key_frames") {
            forceKeyFrames = (args[++i] ?? "").split(",").map(parseHlsDuration);
            if (forceKeyFrames.some(value => !Number.isFinite(value))) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Invalid -force_key_frames timestamp list\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-c:v" || arg === "-vcodec" || arg === "-codec:v") {
            videoCodec = args[++i];
          } else if (arg === "-c:a" || arg === "-acodec" || arg === "-codec:a") {
            const value = args[++i];
            if (args.slice(i + 1).includes("-i")) pendingAudioDecoder = value;
            else audioCodec = value;
          } else if (arg === "-c:s" || arg === "-scodec" || arg === "-codec:s") {
            subtitleCodec = args[++i];
          } else if (arg === "-an") {
            stripAudio = true;
          } else if (arg === "-vn") {
            stripVideo = true;
          } else if (arg === "-sn") {
            stripSubtitles = true;
          } else if (arg === "-dn") {
            stripData = true;
          } else if (arg === "-shortest") {
            shortest = true;
          } else if (arg === "-frames" || arg.startsWith("-frames:") || arg === "-vframes" || arg === "-aframes") {
            let entry: [string, number];
            try {
              entry = parseFrameLimit(arg, args[++i]);
            } catch (error) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${(error as Error).message}\n`), context.signal);
              return { exitCode: 1 };
            }
            frameLimits.push(entry);
            if (entry[0] === "v" || entry[0] === "") maxVideoFrames = entry[1] < 0 ? undefined : entry[1];
          } else if (arg === "-fs") {
            try {
              fileSize = parseFileSize(args[++i]);
            } catch {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid file size limit\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-id3v2_version") {
            const value = args[++i];
            if (value !== "0" && value !== "3" && value !== "4") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid ID3v2 version: expected 0, 3 or 4\n"), context.signal);
              return { exitCode: 1 };
            }
            id3v2Version = Number(value) as 0 | 3 | 4;
          } else if (arg === "-write_apetag") {
            const value = args[++i];
            if (value !== "0" && value !== "1") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid write_apetag: expected 0 or 1\n"), context.signal);
              return { exitCode: 1 };
            }
            writeApetag = value === "1";
          } else if (arg === "-pes_payload_size") {
            const value = args[++i];
            pesPayloadSize = value?.trim() ? Number(value) : NaN;
          } else if (arg === "-mpegts_start_pid") {
            const value = args[++i];
            mpegtsStartPid = value?.trim() ? Number(value) : NaN;
          } else if (arg === "-write_mpeg2") {
            try {
              writeMpeg2 = parseFilterBoolean(args[++i] ?? "invalid", "Invalid write_mpeg2: expected a Boolean");
            } catch (error) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${(error as Error).message}\n`), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-write_id3v2") {
            const value = args[++i];
            if (value !== "0" && value !== "1") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid write_id3v2: expected 0 or 1\n"), context.signal);
              return { exitCode: 1 };
            }
            writeId3v2 = value === "1";
          } else if (arg === "-write_id3v1") {
            const value = args[++i];
            if (value !== "0" && value !== "1") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid write_id3v1: expected 0 or 1\n"), context.signal);
              return { exitCode: 1 };
            }
            writeId3v1 = value === "1";
          } else if (arg === "-sample_fmt") {
            sampleFormat = args[++i];
            if (!sampleFormat) throw new Error("Missing sample_fmt value");
          } else if (arg === "-ch_mode") {
            channelMode = args[++i];
            if (!channelMode) throw new Error("Missing ch_mode value");
          } else if (arg === "-trellis") {
            const value = args[++i];
            trellis = value?.trim() ? Number(value) : NaN;
            if (!Number.isInteger(trellis) || trellis < 0 || trellis > 16) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid trellis: expected an integer from 0 to 16\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-block_size") {
            const value = args[++i];
            blockSize = value?.trim() ? Number(value) : NaN;
          } else if (arg === "-frame_size") {
        const value = args[++i];
        frameSize = value?.trim() ? Number(value) : NaN;
        if (!Number.isInteger(frameSize) || frameSize < 0 || frameSize > 2147483647) {
          await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid frame_size: expected an integer from 0 to 2147483647\n"), context.signal);
          return { exitCode: 1 };
        }
      } else if (arg === "-exact_rice_parameters") {
        const value = args[++i];
        exactRiceParameters = value?.trim() ? Number(value) : NaN;
      } else if (arg === "-multi_dim_quant") {
        const value = args[++i];
        multiDimQuant = value?.trim() ? Number(value) : NaN;
      } else if (arg === "-min_partition_order") {
        const value = args[++i];
        minPartitionOrder = value?.trim() ? Number(value) : NaN;
      } else if (arg === "-max_partition_order") {
        const value = args[++i];
        maxPartitionOrder = value?.trim() ? Number(value) : NaN;
      } else if (arg === "-min_prediction_order") {
        const value = args[++i];
        minPredictionOrder = value?.trim() ? Number(value) : NaN;
      } else if (arg === "-max_prediction_order") {
        const value = args[++i];
        maxPredictionOrder = value?.trim() ? Number(value) : NaN;
      } else if (arg === "-prediction_order_method") {
        predictionOrderMethod = args[++i] ?? "";
      } else if (arg === "-lpc_coeff_precision") {
        const value = args[++i];
        lpcCoeffPrecision = value?.trim() ? Number(value) : NaN;
      } else if (arg === "-lpc_passes") {
        const value = args[++i];
        lpcPasses = value?.trim() ? Number(value) : NaN;
      } else if (arg === "-lpc_type") {
        lpcType = args[++i] ?? "";
      } else if (arg === "-compression_level") {
            const value = args[++i];
            compressionLevel = value?.trim() ? Number(value) : NaN;
            if (!Number.isInteger(compressionLevel)) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid compression_level value\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-rle") {
            const value = args[++i];
            if (value !== "0" && value !== "1") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: rle must be 0 or 1\n"), context.signal);
              return { exitCode: 1 };
            }
            rle = value === "1";
          } else if (arg === "-global_palette") {
            const value = args[++i];
            if (value !== "0" && value !== "1") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: global_palette must be 0 or 1\n"), context.signal);
              return { exitCode: 1 };
            }
            globalPalette = value === "1";
          } else if (arg === "-final_delay") {
            const value = args[++i];
            finalDelay = value?.trim() ? Number(value) : NaN;
            if (!Number.isInteger(finalDelay) || finalDelay < -1 || finalDelay > 65535) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid final_delay: expected an integer from -1 to 65535\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-plays") {
            const value = args[++i];
            apngPlays = value?.trim() ? Number(value) : NaN;
            if (!Number.isInteger(apngPlays) || apngPlays < 0 || apngPlays > 4294967295) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Invalid plays: expected an integer from 0 to 4294967295\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-mpegts_service_id") {
            const value = args[++i];
            mpegtsServiceId = value?.trim() ? Number(value) : NaN;
            if (!Number.isInteger(mpegtsServiceId) || mpegtsServiceId < 1 || mpegtsServiceId > 65535) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Invalid mpegts_service_id: expected an integer from 1 to 65535\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-serial_offset") {
            const value = args[++i];
            serialOffset = value?.trim() ? Number(value) : NaN;
            if (!Number.isInteger(serialOffset) || serialOffset < 0 || serialOffset > 2147483647) throw new Error("Invalid serial_offset: expected an integer from 0 to 2147483647");
          } else if (arg === "-bitexact") {
            bitexact = true;
          } else if (arg === "-fflags") {
            const value = args[++i];
            if (value === "autobsf" || value === "+autobsf" || value === "-autobsf") {
              if (!args.slice(i + 1).includes("-i")) autobsf = value !== "-autobsf";
            } else {
              if (value !== "bitexact" && value !== "+bitexact") throw new Error("Unsupported fflags: expected bitexact or autobsf");
              bitexact = true;
              serialOffset ??= 0;
              if (value === "bitexact" && !args.slice(i + 1).includes("-i")) autobsf = false;
            }
          } else if (arg === "-page_duration") {
            const value = args[++i];
            pageDuration = value?.trim() ? Number(value) : NaN;
            if (!Number.isSafeInteger(pageDuration) || pageDuration < 0) throw new Error("Invalid page_duration: expected nonnegative integer microseconds");
          } else if (arg === "-cluster_time_limit") {
            const value = args[++i];
            clusterTimeLimit = value?.trim() ? Number(value) : NaN;
            if (!Number.isSafeInteger(clusterTimeLimit) || clusterTimeLimit < -1) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Invalid cluster_time_limit: expected integer milliseconds from -1 to 9007199254740991\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-cues_to_front") {
            const value = args[++i];
            try {
              if (value === undefined) throw new Error("Invalid cues_to_front: expected a Boolean");
              cuesToFront = parseFilterBoolean(value, "Invalid cues_to_front: expected a Boolean");
            } catch (error) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${(error as Error).message}\n`), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-reserve_index_space") {
            const value = args[++i];
            reserveIndexSpace = value?.trim() ? Number(value) : NaN;
            if (!Number.isInteger(reserveIndexSpace) || reserveIndexSpace < 0 || reserveIndexSpace > 2147483647) {
              throw new Error("Invalid reserve_index_space: expected an integer from 0 to 2147483647");
            }
          } else if (arg === "-metadata_header_padding") {
            const value = args[++i];
            metadataHeaderPadding = value?.trim() ? Number(value) : NaN;
            if (!Number.isInteger(metadataHeaderPadding) || metadataHeaderPadding < -1 || metadataHeaderPadding > 2147483647) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid metadata_header_padding: expected an integer from -1 to 2147483647\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-write_tmcd") {
            const value = args[++i];
            if (value !== "0" && value !== "1" && value !== "-1") throw new Error("invalid write_tmcd value: expected -1, 0 or 1");
            writeTmcd = value !== "0";
          } else if (arg === "-write_channel_mask") {
            const value = args[++i];
            if (value !== "0" && value !== "1") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid write_channel_mask value: expected 0 or 1\n"), context.signal);
              return { exitCode: 1 };
            }
            // FFmpeg retains the WAV channel mask for both values.
          } else if (arg === "-pat_period") {
            patPeriod = parseHlsDuration(args[++i] ?? "");
            if (!Number.isFinite(patPeriod) || patPeriod < 0) {
              throw new Error("Invalid pat_period: expected nonnegative seconds");
            }
          } else if (arg === "-write_crc32") {
            const value = args[++i];
            if (value !== "0" && value !== "1") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid write_crc32 value: expected 0 or 1\n"), context.signal);
              return { exitCode: 1 };
            }
            writeCrc32 = value === "1";
          } else if (arg === "-write_bext") {
            const value = args[++i];
            if (value !== "0" && value !== "1") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid write_bext value\n"), context.signal);
              return { exitCode: 1 };
            }
            writeBext = value === "1";
          } else if (arg === "-write_header") {
            const value = args[++i];
            if (value !== "0" && value !== "1") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid write_header value: expected 0 or 1\n"), context.signal);
              return { exitCode: 1 };
            }
            writeHeader = value === "1";
          } else if (arg === "-write_xing") {
            const value = args[++i];
            if (value !== "0" && value !== "1") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid write_xing value\n"), context.signal);
              return { exitCode: 1 };
            }
            writeXing = value === "1";
          } else if (arg === "-peak_block_size" || arg === "-peak_format" || arg === "-peak_ppv") {
        const value = args[++i];
        const number = value?.trim() ? Number(value) : NaN;
        const min = arg === "-peak_block_size" ? 0 : 1;
        const max = arg === "-peak_block_size" ? 65536 : 2;
        if (!Number.isInteger(number) || number < min || number > max) {
          throw new Error(`Invalid ${arg.slice(1)}: expected an integer from ${min} to ${max}`);
        }
        if (arg === "-peak_block_size") peakBlockSize = number;
        else if (arg === "-peak_format") peakFormat = number;
        else peakPpv = number;
      } else if (arg === "-write_peak") {
            const value = args[++i];
            const mode = value === "0" ? "off" : value === "1" ? "on" : value === "2" ? "only" : value;
            if (mode !== "off" && mode !== "on" && mode !== "only") {
              throw new Error("Invalid write_peak value: expected off, on or only");
            }
            writePeak = mode;
          } else if (arg === "-rf64") {
            const value = args[++i];
            if (value !== "always" && value !== "auto" && value !== "never") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Invalid rf64 value: expected always, auto or never\n"), context.signal);
              return { exitCode: 1 };
            }
            rf64 = value;
          } else if (arg === "-pcr_period") {
            const value = args[++i];
            pcrPeriod = value?.trim() ? Number(value) : NaN;
          } else if (arg === "-muxrate") {
            muxRate = parseBitrate(args[++i]);
            if (muxRate === undefined) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Invalid muxrate: expected an integer from 0 to 2147483647 bits/s\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-movie_timescale") {
            const value = args[++i];
            movieTimescale = value?.trim() ? Number(value) : NaN;
            if (!Number.isInteger(movieTimescale) || movieTimescale < 1 || movieTimescale > 2147483647) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -movie_timescale requires an integer from 1 to 2147483647\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-video_track_timescale") {
            const value = args[++i];
            videoTrackTimescale = value?.trim() ? Number(value) : NaN;
            if (!Number.isInteger(videoTrackTimescale) || videoTrackTimescale < 0 || videoTrackTimescale > 2147483647) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -video_track_timescale requires an integer from 0 to 2147483647\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-brand") {
            const value = args[++i];
            if (value === undefined) throw new Error("-brand requires a value");
            majorBrand = value.length >= 4 ? value.slice(0, 4) : undefined;
          } else if (arg === "-fragment_index") {
            const value = args[++i];
            fragmentIndex = value?.trim() ? Number(value) : NaN;
            if (!Number.isInteger(fragmentIndex) || fragmentIndex < 1 || fragmentIndex > 2147483647) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -fragment_index requires an integer from 1 to 2147483647\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-frag_duration") {
            fragmentDurationArg = args[++i] ?? "";
          } else if (arg === "-default_mode") {
            defaultMode = args[++i] ?? "";
            if (!["passthrough", "infer", "infer_no_subs"].includes(defaultMode)) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: -default_mode requires passthrough, infer, or infer_no_subs\n"), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-live") {
            try {
              live = parseFilterBoolean(args[++i] ?? "invalid", "Invalid live value: expected a boolean");
            } catch (error) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${(error as Error).message}\n`), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-tables_version") {
            try {
              mpegtsTablesVersion = parseMpegtsTablesVersion(args[++i] ?? "");
            } catch (error) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${(error as Error).message}\n`), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-omit_video_pes_length") {
            try {
              omitVideoPesLength = parseFilterBoolean(args[++i] ?? "invalid", "Invalid omit_video_pes_length: expected a boolean");
            } catch (error) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${(error as Error).message}\n`), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-mpegts_service_type") {
            try {
              mpegtsServiceType = parseMpegtsServiceType(args[++i] ?? "");
            } catch (error) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${(error as Error).message}\n`), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-mpegts_flags") {
            try {
              mpegtsFlags = parseMpegtsFlags(args[++i] ?? "", mpegtsFlags);
            } catch (error) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${(error as Error).message}\n`), context.signal);
              return { exitCode: 1 };
            }
          } else if (arg === "-movflags") {
            const flags = args[++i] ?? "";
            try {
              validateMovflags(flags);
            } catch (error) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${(error as Error).message}\n`), context.signal);
              return { exitCode: 1 };
            }
            if (flags.includes("skip_trailer")) skipTrailer = true;
            if (flags.includes("write_colr")) writeColr = true;
            if (flags.includes("dash")) {
              segmentIndex ??= "fragment";
              emptyMoov = true;
              defaultBaseMoof = true;
              fragmented = true;
            }
            if (flags.includes("global_sidx")) segmentIndex = "global";
            if (flags.includes("default_base_moof")) defaultBaseMoof = true;
            if (!flags.startsWith("+") && !flags.startsWith("-")) { faststart = false; useMetadataTags = false; disableChpl = false; }
            for (const flag of flags.split("-").join("+-").split("+")) {
              if (flag === "disable_chpl") disableChpl = true;
              if (flag === "-disable_chpl") disableChpl = false;
              if (flag === "use_metadata_tags") useMetadataTags = true;
              if (flag === "-use_metadata_tags") useMetadataTags = false;
              if (flag === "faststart") faststart = true;
              if (flag === "-faststart") faststart = false;
            }
            if (flags.includes("empty_moov")) emptyMoov = true;
            if (flags.includes("frag_every_frame")) fragmentEveryFrame = true;
            if (flags.includes("frag_keyframe")) fragmentKeyframes = true;
            if (flags.includes("frag_keyframe") || flags.includes("frag_every_frame") || flags.includes("empty_moov")) {
              fragmented = true;
            }
          } else if (arg === "-streamid") {
            const value = args[++i];
            const parts = value?.split(":") ?? [];
            const ordinal = Number(parts[0]);
            const id = Number(parts[1]);
            if (parts.length !== 2 || parts.some(part => !part.trim()) ||
                !Number.isInteger(ordinal) || ordinal < 0 || ordinal > 2147483647 ||
                !Number.isInteger(id) || id < -2147483648 || id > 2147483647) {
              throw new Error(`Invalid -streamid value '${value ?? ""}'`);
            }
            streamIds.set(ordinal, id);
          } else if (arg === "-use_stream_ids_as_track_ids") {
            const value = args[++i];
            if (value !== "0" && value !== "1") throw new Error("-use_stream_ids_as_track_ids requires 0 or 1");
            useStreamIdsAsTrackIds = value === "1";
          } else if (arg === "-map") {
            const m = args[++i];
            if (m) maps.push(m);
          } else if (arg === "-vf" || arg === "-filter:v") {
            const f = args[++i];
            if (f) vfFilters.push(f);
          } else if (arg === "-af" || arg === "-filter:a" || arg.startsWith("-af:") || arg.startsWith("-filter:a:")) {
            const f = args[++i];
            const selector = arg.startsWith("-af:") ? arg.slice(4)
              : arg.startsWith("-filter:a:") ? arg.slice(10) : undefined;
            const ordinal = selector === undefined ? undefined : Number(selector);
            if (selector !== undefined && (!selector || !Array.from(selector).every(char => char >= "0" && char <= "9") || !Number.isSafeInteger(ordinal))) {
              throw new Error(`Unsupported audio stream specifier: ${selector}`);
            }
            if (f) afFilters.push({ ordinal, expression: f });
          } else if (arg === "-filter_complex" || arg === "-lavfi") {
            filterComplex = args[++i];
          } else if (arg === "-disposition" || arg.startsWith("-disposition:")) {
            streamDispositions.push([arg.slice("-disposition:".length), args[++i] ?? ""]);
          } else if (arg === "-attach") {
            const filename = args[++i];
            if (!filename) throw new Error("-attach requires a filename");
            attachmentFiles.push(filename);
          } else if (arg === "-timecode") {
            metadata.timecode = args[++i] ?? "";
          } else if (arg === "-metadata" || arg.startsWith("-metadata:")) {
            const type = arg["-metadata:".length] ?? "g";
            if (type !== "g" && type !== "s" && type !== "c" && type !== "p") {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Invalid metadata type ${type}.\n`), context.signal);
              return { exitCode: 234 };
            }
            if (arg === "-metadata:s" || arg.startsWith("-metadata:s:")) {
              try {
                validateMetadataStreamSpecifier(arg.slice("-metadata:s:".length));
              } catch (error) {
                await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${(error as Error).message}.\n`), context.signal);
                return { exitCode: 234 };
              }
            }
            const kv = args[++i] ?? "";
            const eq = kv.indexOf("=");
            if (eq < 0) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: No '=' character in metadata string ${kv}.\n`), context.signal);
              return { exitCode: 234 };
            }
            if (eq >= 0) {
              const k = kv.slice(0, eq).trim().toLowerCase();
              const v = kv.slice(eq + 1);
              if (arg === "-metadata:s" || arg.startsWith("-metadata:s:")) {
                attachmentMetadata.push([arg.slice("-metadata:s:".length), k, v]);
              }
              if ((k === "language" || k === "handler_name" || k === "timecode" || k === "title" || k === "comment" || k === "stereo_mode") && (arg === "-metadata:s" || arg.startsWith("-metadata:s:"))) {
                streamMetadata.push([arg.slice("-metadata:s:".length), k === "handler_name" ? "handlerName" : k, v]);
              } else if (arg !== "-metadata:s" && !arg.startsWith("-metadata:s:")) metadata[k] = v;
            }
          } else if (["-color_primaries", "-color_trc", "-colorspace", "-color_range"].includes(arg.split(":")[0]!)) {
            try {
              outputColors.push(parseOutputColorOption(arg, args[++i]));
            } catch (error) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${(error as Error).message}\n`), context.signal);
              return { exitCode: 234 };
            }
          } else if (arg === "-aspect" || arg.startsWith("-aspect:")) {
            try {
              displayAspects.push(parseDisplayAspect(arg, args[++i]));
            } catch (error) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${(error as Error).message}\n`), context.signal);
              return { exitCode: 234 };
            }
          } else if (["-display_rotation", "-display_hflip", "-display_vflip"].some(option => arg === option || arg.startsWith(`${option}:`))) {
            try {
              pendingDisplayTransforms.push(parseDisplayTransform(arg, arg.split(":")[0] === "-display_rotation" ? args[++i] : undefined));
            } catch (error) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${(error as Error).message}\n`), context.signal);
              return { exitCode: 234 };
            }
            if (!args.slice(i + 1).includes("-i")) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${arg.split(":")[0]} must precede an input\n`), context.signal);
              return { exitCode: 234 };
            }
          } else if (!arg.startsWith("-") || arg === "-") {
            outputTarget = arg;
            i++;
            break;
          } else {
            await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Unrecognized option '${arg.slice(1)}'\n`), context.signal);
            return { exitCode: 8 };
          }
          if (i >= args.length) {
            await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Missing argument for option '${arg.slice(1)}'\n`), context.signal);
            return { exitCode: 234 };
          }
        }


        // HLS values are per-output assignments; only signed flags modify earlier values.
        for (const [option, value] of [["hls_time", hlsTime], ["hls_init_time", hlsInitTime]] as const) {
          if (!Number.isFinite(value) || value < 0 || value > 9_223_372_036_854.775) {
            await writeBytes(context.stderr, encodeUtf8(`ffmpeg: invalid ${option}\n`), context.signal);
            return { exitCode: 1 };
          }
        }
        if (!Number.isFinite(hlsListSize) || hlsListSize < 0 || hlsListSize > 2147483647) {
          await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid hls_list_size\n"), context.signal);
          return { exitCode: 1 };
        }
        hlsListSize = roundToEven(hlsListSize);
        if (!Number.isSafeInteger(hlsDeleteThreshold) || hlsDeleteThreshold < 1 || hlsDeleteThreshold > 2147483647) {
          await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid hls_delete_threshold\n"), context.signal);
          return { exitCode: 1 };
        }
        if (hlsSegmentType === "0") hlsSegmentType = "mpegts";
        else if (hlsSegmentType === "1") hlsSegmentType = "fmp4";
        if (hlsSegmentType !== undefined && hlsSegmentType !== "mpegts" && hlsSegmentType !== "fmp4") {
          await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid hls_segment_type\n"), context.signal);
          return { exitCode: 1 };
        }
        if (hlsPlaylistType === "0") hlsPlaylistType = undefined;
        else if (hlsPlaylistType === "1") hlsPlaylistType = "event";
        else if (hlsPlaylistType === "2") hlsPlaylistType = "vod";
        if (hlsPlaylistType !== undefined && hlsPlaylistType !== "vod" && hlsPlaylistType !== "event") {
          await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid hls_playlist_type\n"), context.signal);
          return { exitCode: 1 };
        }
        if (hlsFlags === "") {
          await writeBytes(context.stderr, encodeUtf8("ffmpeg: invalid HLS flags\n"), context.signal);
          return { exitCode: 1 };
        }
        const flagBits: Record<string, number> = {
          single_file: 1,
          delete_segments: 2,
          round_durations: 4,
          discont_start: 8,
          omit_endlist: 16,
          split_by_time: 32,
          append_list: 64,
          program_date_time: 128,
          second_level_segment_index: 256,
          temp_file: 2048,
          independent_segments: 8192,
          iframes_only: 16384
        };
        const supportedMask = Object.values(flagBits).reduce((mask, bit) => mask | bit, 0);
        for (const flag of (hlsFlags ?? "").replaceAll("-", "+-").split("+")) {
          if (!flag) continue;
          const enabled = !flag.startsWith("-");
          const name = enabled ? flag : flag.slice(1);
          const mask = Object.hasOwn(flagBits, name) ? flagBits[name]! : name.trim() ? Number(name) : NaN;
          if (!Number.isInteger(mask) || (mask & supportedMask) !== mask) {
            await writeBytes(context.stderr, encodeUtf8(`ffmpeg: unrecognized HLS flag '${name}'\n`), context.signal);
            return { exitCode: 1 };
          }
          if (mask & flagBits.single_file!) hlsSingleFile = enabled;
          if (mask & flagBits.temp_file!) hlsTempFile = enabled;
          if (mask & flagBits.delete_segments!) hlsDeleteSegments = enabled;
          if (mask & flagBits.round_durations!) hlsRoundDurations = enabled;
          if (mask & flagBits.discont_start!) hlsDiscontStart = enabled;
          if (mask & flagBits.omit_endlist!) hlsOmitEndlist = enabled;
          if (mask & flagBits.split_by_time!) hlsSplitByTime = enabled;
          if (mask & flagBits.append_list!) hlsAppendList = enabled;
          if (mask & flagBits.program_date_time!) hlsProgramDateTime = enabled;
          if (mask & flagBits.second_level_segment_index!) hlsSecondLevelSegmentIndex = enabled;
          if (mask & flagBits.independent_segments!) hlsIndependentSegments = enabled;
          if (mask & flagBits.iframes_only!) hlsIframesOnly = enabled;
        }

        if (inputs.length === 0) {
          await writeBytes(
            context.stderr,
            encodeUtf8("ffmpeg: must specify at least one input (-i)\n"),
            context.signal
          );
          return { exitCode: 1 };
        }

        // A filename closes its option group; trailing options have no output.
        if (!outputTarget) break;
        if (fragmentDurationArg !== undefined) {
          // DASH accepts seconds, while the MP4 muxer uses integer microseconds.
          const dash = outputFormat === "dash" || outputTarget.toLowerCase().endsWith(".mpd");
          fragmentDuration = dash ? Math.round(parseHlsDuration(fragmentDurationArg) * 1_000_000)
            : fragmentDurationArg.trim() ? Number(fragmentDurationArg) : NaN;
          if (!Number.isInteger(fragmentDuration) || fragmentDuration < 0 || fragmentDuration > 2147483647) {
            await writeBytes(context.stderr, encodeUtf8(dash ? "ffmpeg: invalid DASH frag_duration\n"
              : "ffmpeg: -frag_duration requires an integer from 0 to 2147483647 microseconds\n"), context.signal);
            return { exitCode: 1 };
          }
          if (!dash && fragmentDuration > 0) fragmented = true;
        }
        if (outputFps !== undefined && !["auto", "-1", "cfr", "1"].includes(videoSync)) {
          await writeBytes(context.stderr,
            encodeUtf8("ffmpeg: output -r is contradictory to a non-CFR -vsync/-fps_mode\n"), context.signal);
          return { exitCode: 234 };
        }
        if (pendingDumpAttachments.length) throw new Error("-dump_attachment must precede its input file");
        if (fileSize !== undefined && (audioCodec !== "copy" ||
          (outputFormat ? registry.findByFormatName(outputFormat) : registry.findByFilename(outputTarget))?.id !== "wav")) {
          throw new Error("-fs currently requires WAV output with audio stream copy");
        }
        const frameChecksumOutput = outputFormat === "framemd5" || outputFormat === "framehash" || outputFormat === "framecrc";
        const checksumOutput = frameChecksumOutput || outputFormat === "streamhash" || outputFormat === "hash" || outputFormat === "md5" || outputFormat === "crc";
        const target = outputTarget;
        const protocolTargets = target.startsWith("tee:") ? target.slice(4).split("|") : [target];
        const progressOutputIndex = outputs.length;
        const firstOutput = outputs.length === 0;
        initializers.push(async () => {
          const outputTarget = target;
          if (outputDuration === undefined && outputTo !== undefined && outputTo <= (outputSs ?? 0)) {
            throw new Error("-to value smaller than -ss; aborting.");
          }
          if (outputFormat === "tee") {
            if (!maps.length) throw new Error("Output file does not contain any stream; tee requires -map");
            parseTee(outputTarget);
            return;
          }
          for (const outputTarget of protocolTargets) {
            if (!outputTarget) throw new Error("Empty tee protocol destination");
            if (outputFormat !== "null" && outputTarget !== "/dev/null" && !isStdout(outputTarget) && !outputTarget.startsWith("md5:")) {
              const inputIndex = inputs.findIndex(input =>
                input.format !== "lavfi" && !isStdin(input.path) &&
                resolvePath(context.cwd, input.path) === resolvePath(context.cwd, outputTarget) &&
                (input.patternType === "none" || input.patternType === "glob" ||
                  formatImageSequence(input.path, input.startNumber ?? 0) === undefined));
              if (inputIndex >= 0) throw new Error(`Output ${outputTarget} same as Input #${inputIndex} - exiting. FFmpeg cannot edit existing files in-place.`);
            }
            // Virtual streams are non-interactive: replacing a file requires -y.
            if (
              !overwrite &&
              !outputTarget.startsWith("md5:") &&
              !isStdout(outputTarget) &&
              outputFormat !== "null"
            ) {
              const outFull = resolvePath(context.cwd, outputTarget);
              try {
                await context.fs.stat(outFull, { signal: context.signal });
                await writeBytes(context.stderr,
                  encodeUtf8(`File '${outputTarget}' already exists. Exiting.\nError opening output file ${outputTarget}.\n`), context.signal);
                return { exitCode: overwrite === false ? 0 : 1 };
              } catch (error) {
                rethrowRuntimeError(context, error);
                if ((error as { code?: string }).code !== "ENOENT") throw error;
                // File does not exist, proceed
              }
            }
          }

          const plugin = outputFormat
            ? (registry.findById(outputFormat) ?? registry.findByFormatName(outputFormat))
            : registry.findByFilename(outputTarget);
          const format = outputFormat ?? outputTarget.split(".").pop()?.toLowerCase();
          if (!plugin?.canMux && !["null", "segment", "data", "rawvideo", "image2pipe", "ico", "apng", "framemd5", "framehash", "framecrc", "streamhash", "hash", "md5", "crc"].includes(format ?? "")) {
            throw new Error(`Unable to find a suitable output format for '${outputFormat ?? outputTarget}' (format AST not registered)`);
          }
          // Open every protocol destination in order, reporting partial open failures.
          if ((target.startsWith("tee:") || progressOutputIndex < outputs.length - 1) &&
              format !== "null" && format !== "segment" && plugin?.id !== "hls" && plugin?.id !== "image2") {
            for (const destination of protocolTargets) {
              if (!isStdout(destination) && destination !== "/dev/null" && !destination.startsWith("md5:")) {
                await context.fs.writeFile(resolvePath(context.cwd, destination), new Uint8Array(0), { signal: context.signal });
              }
            }
          }
        });
        for (const map of maps) audioOutputMaps.add(map);
        outputs.push(async () => {
          const outputTarget = target;
          try {
            let concatInputSeek = false;
            const loadSingleDocument = async (
              filePath: string,
              explicitFormat?: string,
              fpsHint?: number,
              input?: InputSpec,
              ignoreEditList = false
            ): Promise<MediaDocument> => {
              if (explicitFormat === "lavfi") {
                if (features.lavfiSources === false) {
                  throw new Error("lavfi synthetic sources are disabled by consumer feature configuration");
                }
                const steps = lavfiSteps(filePath, budget, input?.durationSeconds !== undefined
                  ? (input.startSeconds ?? 0) + input.durationSeconds
                  : input?.endSeconds ?? (outputDuration !== undefined
                    ? (input?.startSeconds ?? 0) + (outputSs ?? 0) + outputDuration
                    : outputTo !== undefined ? (input?.startSeconds ?? 0) + outputTo : undefined));
                let step = steps.next();
                while (!step.done) {
                  await yieldTurn(context.signal);
                  context.signal.throwIfAborted();
                  step = steps.next();
                }
                return step.value;
              }

              const imageDemuxer = explicitFormat === "image2" || (!explicitFormat &&
                (filePath.endsWith(".Y") || (registry.findById("image2")?.extensions.includes(filePath.split(".").pop()?.toLowerCase() ?? "") &&
                  (formatImageSequence(filePath, 0) !== undefined || filePath.includes("*") || filePath.includes("?")))));
              const pipeBytes = explicitFormat === "image2pipe"
                ? (await readInput(filePath)).subarray(input?.skipInitialBytes ?? 0) : undefined;
              let pipeOffset = 0;
              let globPaths: string[] | undefined;
              let globPattern = imageDemuxer && input?.patternType === "glob" ? filePath : undefined;
              if (imageDemuxer && (input?.patternType === undefined || input.patternType === "glob_sequence")) {
                let converted = "";
                let hasGlob = false;
                for (let i = 0; i < filePath.length; i++) {
                  budget.checkCpu();
                  const character = filePath[i]!;
                  const next = filePath[i + 1];
                  if (character === "%" && next !== undefined && "%*?[]{}".includes(next)) {
                    hasGlob ||= next !== "%";
                    converted += next;
                    i++;
                  } else {
                    if ("\\*?[]{}".includes(character)) converted += "\\";
                    converted += character;
                  }
                }
                if (hasGlob) globPattern = converted;
              }
              if (!pipeBytes && globPattern !== undefined) {
                globPaths = [];
                for (const pattern of expandImageGlob(globPattern, budget)) {
                  let alternativePaths = ["/"];
                  for (const component of resolvePath(context.cwd, pattern).split("/").filter(Boolean)) {
                    const matches: string[] = [];
                    for (const directory of alternativePaths) {
                      budget.checkCpu();
                      context.signal.throwIfAborted();
                      let entries;
                      try {
                        entries = await context.fs.readdir(directory, { signal: context.signal });
                      } catch (error) {
                        rethrowRuntimeError(context, error);
                        if (["ENOENT", "ENOTDIR"].includes((error as { code?: string }).code ?? "")) continue;
                        throw error;
                      }
                      for (const entry of entries) {
                        budget.checkCpu();
                        if (entry.name.startsWith(".") && !component.startsWith(".") && !component.startsWith("\\.")) continue;
                        if (matchesImageGlob(component, entry.name, budget)) matches.push(resolvePath(directory, entry.name));
                      }
                    }
                    alternativePaths = matches;
                  }
                  // C-locale glob ordering compares filename bytes, not UTF-16 units.
                  const encodedPaths = alternativePaths.map(path => ({ path, bytes: encodeUtf8(path) }));
                  encodedPaths.sort((a, b) => {
                    for (let i = 0; i < Math.min(a.bytes.length, b.bytes.length); i++) {
                      const difference = a.bytes[i]! - b.bytes[i]!;
                      if (difference) return difference;
                    }
                    return a.bytes.length - b.bytes.length;
                  });
                  for (const { path } of encodedPaths) globPaths.push(path);
                }
              }

              const planeInput = !pipeBytes && filePath.endsWith(".Y") && (!explicitFormat || explicitFormat === "image2");
              const literalPlane = planeInput && (input?.patternType === "none" || formatImageSequence(filePath, 0) === undefined);
              // Literal image inputs bypass numbered-pattern expansion.
              if (planeInput || pipeBytes || globPaths || (imageDemuxer && input?.patternType !== "none" && formatImageSequence(filePath, input?.startNumber ?? 0) !== undefined)) {
                const frames: MediaVideoFrame[] = [];
                const packets: Uint8Array[] = [];
                let codecName = "png";
                let pixelFormat = "rgb24";
                let sarWidth = 1;
                let sarHeight = 1;
                const fps = fpsHint ?? 25;
                const startNumber = input?.startNumber ?? 0;
                const startNumberRange = input?.startNumberRange ?? 5;
                for (let idx = globPaths ? 0 : startNumber; pipeBytes ? pipeOffset < pipeBytes.length : !globPaths || idx < globPaths.length; idx++) {
                  budget.checkCpu();
                  context.signal.throwIfAborted();
                  let imgBytes: Uint8Array;
                  let planeFrame: MediaVideoFrame | undefined;
                  if (pipeBytes) {
                    const start = pipeOffset;
                    if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => pipeBytes[start + i] === byte)) {
                      throw new Error("image2pipe input requires complete PNG datastreams");
                    }
                    pipeOffset += 8;
                    const view = new DataView(pipeBytes.buffer, pipeBytes.byteOffset, pipeBytes.byteLength);
                    for (;;) {
                      budget.checkCpu();
                      context.signal.throwIfAborted();
                      if (pipeOffset + 12 > pipeBytes.length) throw new Error("Truncated image2pipe PNG chunk");
                      const length = view.getUint32(pipeOffset);
                      const end = view.getUint32(pipeOffset + 4) === 0x49454e44; // IEND
                      if (length > pipeBytes.length - pipeOffset - 12) throw new Error("Truncated image2pipe PNG chunk");
                      pipeOffset += length + 12;
                      if (end) {
                        if (length !== 0) throw new Error("Invalid image2pipe PNG IEND chunk");
                        break;
                      }
                    }
                    imgBytes = pipeBytes.subarray(start, pipeOffset);
                  } else {
                    const formatted = globPaths ? globPaths[idx]! : literalPlane ? filePath : formatImageSequence(filePath, idx, false)!;
                    const resolved = resolvePath(context.cwd, formatted);
                    try {
                      imgBytes = await readInput(resolved);
                    } catch (error) {
                      rethrowRuntimeError(context, error);
                      if ((error as { code?: string }).code !== "ENOENT") throw error;
                      if (globPaths || literalPlane) throw error;
                      if (frames.length === 0 && idx - startNumber < startNumberRange - 1) continue;
                      break;
                    }
                    if (planeInput) {
                      if (input?.pixelFormat !== undefined && input.pixelFormat !== "yuv420p") {
                        throw new Error(`Unsupported image2 plane pixel format '${input.pixelFormat}'`);
                      }
                      const u = await readInput(`${resolved.slice(0, -1)}U`);
                      const v = await readInput(`${resolved.slice(0, -1)}V`);
                      budget.allocateMemory(imgBytes.byteLength + u.byteLength + v.byteLength);
                      const packet = concatBytes([imgBytes, u, v]);
                      const raw = parseRawVideo(packet, input?.videoSize, "yuv420p", fps, budget);
                      planeFrame = raw.tracks[0]?.decodedVideoFrames?.[0];
                      if (!planeFrame ||
                          imgBytes.byteLength !== planeFrame.width * planeFrame.height ||
                          u.byteLength !== Math.ceil(planeFrame.width / 2) * Math.ceil(planeFrame.height / 2) || v.byteLength !== u.byteLength) {
                        throw new Error(`${resolved}: Invalid image2 plane sizes`);
                      }
                      imgBytes = packet;
                    }
                  }
                  {
                    const decoded = planeFrame
                      ? { ...planeFrame, format: "rawvideo", hasAlpha: false, resolution: undefined }
                      : decodeImage(imgBytes);
                    if (frames.length === 0) {
                      codecName = decoded.format === "jpeg" ? "mjpeg" : decoded.format;
                      pixelFormat = planeFrame ? "yuv420p" : decoded.hasAlpha ? "rgba" : "rgb24";
                      sarWidth = decoded.resolution?.x || 1;
                      sarHeight = decoded.resolution?.y || 1;
                    }
                    packets.push(imgBytes);
                    if (decoded.width * decoded.height >= 16384) {
                      const gc = (globalThis as { gc?: () => void }).gc;
                      if (typeof gc === "function") { gc(); gc(); }
                    }
                    if (!planeFrame) budget.recordFrame(decoded.width, decoded.height);
                    frames.push({
                      ...(planeFrame ? { native: planeFrame.native } : {}),
                      width: decoded.width,
                      height: decoded.height,
                      data: decoded.data,
                      ptsSeconds: frames.length / fps,
                      durationSeconds: 1 / fps,
                      keyframe: true
                    });
                  }
                  if (literalPlane && !globPaths) break;
                }
                if (frames.length === 0) {
                  throw new Error(`${filePath}: No matching image sequence files found`);
                }
                const first = frames[0]!;
                const synthBytes = (await yieldTurn(context.signal), context.signal?.throwIfAborted(), createSyntheticMp4({
                  width: 16,
                  height: 16,
                  fps,
                  frameCount: 1,
                  includeAudio: false
                }));
                const base = parseMp4(synthBytes);
                detachBytesBuffer(synthBytes);
                return {
                  ...base,
                  containerFormat: "image2",
                  duration: Math.round(frames.length / fps * base.timescale),
                  durationSeconds: frames.length / fps,
                  tracks: base.tracks.map((t) =>
                    t.type === "video" ? {
                      ...t, width: first.width, height: first.height,
                      duration: Math.round(frames.length / fps * t.timescale),
                      codecDescriptions: [{ codecName, formatFourCC: codecName.padEnd(4, " ").slice(0, 4), width: first.width, height: first.height, pixFmt: pixelFormat, sarWidth, sarHeight }],
                      samples: packets.map((data, index) => ({
                        data, size: data.byteLength,
                        dts: Math.round(index / fps * t.timescale),
                        pts: Math.round(index / fps * t.timescale), cts: 0,
                        duration: Math.round((index + 1) / fps * t.timescale) - Math.round(index / fps * t.timescale),
                        isKeyframe: true, sampleDescriptionIndex: 1
                      })),
                      decodedVideoFrames: frames
                    } : t
                  )
                };
              }

              const rawBytes = (await readInput(filePath)).subarray(input?.skipInitialBytes ?? 0);
              if (input?.patternType !== undefined && !imageDemuxer) {
                throw new Error("Option pattern_type not found");
              }


              if (explicitFormat === "rawvideo") {
                return parseRawVideo(rawBytes, input?.videoSize, input?.pixelFormat, fpsHint ?? 25, budget, videoCodec !== "copy");
              }

              const concatSignature = "ffconcat version 1.0";
              if (explicitFormat === "concat" || (explicitFormat === undefined &&
                new TextDecoder("utf-8", { ignoreBOM: true }).decode(rawBytes.subarray(0, concatSignature.length)) === concatSignature)) {
                const listText = new TextDecoder("utf-8", { ignoreBOM: true }).decode(rawBytes);
                const listDir = filePath === "-" ? context.cwd : dirnameOf(resolvePath(context.cwd, filePath));
                const concatDocs: MediaDocument[] = [];
                const { segments, streamIds, streamTags, chapters } = parseConcatManifest(listText, listDir, input?.safe !== false);
                const startTimesSeconds: number[] = [];
                let nextStartSeconds = 0;
                budget.checkConcatInputs(segments.length);
                for (const segment of segments) {
                  if (segment.inpoint !== undefined && segment.outpoint !== undefined && segment.outpoint < segment.inpoint) {
                    throw new Error(`${segment.path}: outpoint must not precede inpoint`);
                  }
                  let itemDoc: MediaDocument;
                  try {
                    itemDoc = await loadSingleDocument(segment.path, undefined, undefined, undefined, segment.ignoreEditList);
                  } catch (error) {
                    rethrowRuntimeError(context, error);
                    if (!concatDocs.some(doc => doc.tracks.some(track => track.samples.length > 0))) throw error;
                    const message = (error as { code?: string }).code === "ENOENT"
                      ? "No such file or directory" : error instanceof Error ? error.message : String(error);
                    await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Impossible to open '${segment.path}': ${message}\n`), context.signal);
                    inputReadFailed = true;
                    break;
                  }
                  if (input?.autoConvert !== false) {
                    itemDoc = { ...itemDoc, tracks: itemDoc.tracks.map(track => autoConvertConcatTrack(track, budget)) };
                  }
                  const segmentDuration = segment.duration ?? (segment.outpoint ?? itemDoc.durationSeconds) - (segment.inpoint ?? 0);
                  if (input?.segmentTimeMetadata) {
                    segment.tags = { ...segment.tags,
                      "lavf.concatdec.start_time": String(Math.round(nextStartSeconds * 1_000_000)),
                      ...(Number.isFinite(segmentDuration) ? { "lavf.concatdec.duration": String(Math.round(segmentDuration * 1_000_000)) } : {})
                    };
                  }
                  let sliceEnd = segment.outpoint;
                  const wavTrack = itemDoc.containerFormat === "wav" ? itemDoc.tracks[0] : undefined;
                  const packetFrames = wavTrack?.samples[0]?.duration;
                  if (wavTrack && packetFrames && !wavTrack.decodedAudio &&
                    wavTrack.codecDescriptions[0]?.codecName?.startsWith("pcm_") &&
                    segment.inpoint !== undefined && segment.inpoint > 0) {
                    // A PCM seek starts fresh packets at the requested sample frame.
                    const bytesPerFrame = wavTrack.samples[0]!.data.length / packetFrames;
                    const bytes = concatBytes(wavTrack.samples.map(sample => sample.data));
                    const startFrame = Math.round(segment.inpoint * wavTrack.timescale);
                    const samples: MediaTrack["samples"][number][] = [];
                    for (let frame = startFrame; frame * bytesPerFrame < bytes.length; frame += packetFrames) {
                      budget.checkCpu();
                      const data = bytes.subarray(frame * bytesPerFrame, (frame + packetFrames) * bytesPerFrame);
                      samples.push({ data, dts: frame, pts: frame, cts: 0, size: data.length,
                        duration: data.length / bytesPerFrame, isKeyframe: true, sampleDescriptionIndex: 1 });
                    }
                    itemDoc = { ...itemDoc, tracks: [{ ...wavTrack, samples }] };
                  }
                  if (sliceEnd !== undefined && wavTrack && packetFrames) {
                    // WAV seeking starts a new packet at the inpoint. Concat keeps
                    // the whole packet whose DTS precedes the outpoint.
                    const start = Math.max(0, segment.inpoint ?? 0);
                    const packets = Math.ceil(Math.max(0, sliceEnd - start) * wavTrack.timescale / packetFrames);
                    sliceEnd = start + packets * packetFrames / wavTrack.timescale;
                  }
                  if (
                    segment.inpoint !== undefined ||
                    segment.outpoint !== undefined
                  ) {
                    itemDoc = sliceMp4(itemDoc, {
                      startSeconds: segment.inpoint,
                      endSeconds: sliceEnd
                    });
                  }
                  if (segment.tags) {
                    itemDoc = { ...itemDoc, tracks: itemDoc.tracks.map(track => ({
                      ...track, samples: track.samples.map(sample => ({ ...sample, tags: { ...sample.tags, ...segment.tags } }))
                    })) };
                  }
                  if (streamIds.length) {
                    // WAV has demuxer stream ID zero; the AST uses a one-based track ID.
                    const tracks = streamIds.flatMap((id, index) => itemDoc.tracks.filter(track =>
                      id === (itemDoc.containerFormat === "wav" ? 0 : track.id)).map(track => ({
                        ...track, metadata: { ...track.metadata, ...streamTags[index] }
                      })));
                    itemDoc = { ...itemDoc, tracks };
                  }
                  startTimesSeconds.push(nextStartSeconds);
                  nextStartSeconds += segment.duration ?? itemDoc.durationSeconds;
                  concatDocs.push(itemDoc);
                }
                if (streamIds.length && !concatDocs.some(doc => doc.tracks.length)) {
                  throw new Error("Output file does not contain any stream");
                }
                // Only manifest declarations build concat's seek index. Reading
                // clip durations later does not make an unindexed input seekable.
                const seekable = segments.every(segment => segment.duration !== undefined ||
                  segment.inpoint !== undefined && segment.outpoint !== undefined);
                if (input?.startSeconds !== undefined && input.startSeconds > 0 && seekable) {
                  // The duration index selects a file before its demuxer seeks.
                  // Seeking the merged packet list would retain PCM before -ss.
                  let index = startTimesSeconds.length - 1;
                  while (index > 0 && startTimesSeconds[index]! > input.startSeconds) index--;
                  const source = concatDocs[index];
                  const track = source?.containerFormat === "wav" && source.tracks.length === 1
                    ? source.tracks[0] : undefined;
                  const packet = track?.samples[0];
                  if (track && packet && !track.decodedAudio &&
                    track.codecDescriptions[0]?.codecName?.startsWith("pcm_")) {
                    const bytes = concatBytes(track.samples.map(sample => sample.data));
                    const bytesPerFrame = packet.data.length / packet.duration;
                    const requestedFrame = Math.round((input.startSeconds - startTimesSeconds[index]!) * track.timescale);
                    // A failed WAV seek past EOF leaves the final packet queued.
                    const startFrame = requestedFrame > bytes.length / bytesPerFrame
                      ? track.samples.at(-1)!.dts : requestedFrame;
                    const samples: MediaTrack["samples"][number][] = [];
                    for (let frame = startFrame; frame * bytesPerFrame < bytes.length; frame += packet.duration) {
                      budget.checkCpu();
                      const data = bytes.subarray(frame * bytesPerFrame, (frame + packet.duration) * bytesPerFrame);
                      samples.push({ ...packet, data, size: data.length, dts: frame - startFrame,
                        pts: frame - startFrame, duration: data.length / bytesPerFrame });
                    }
                    const duration = bytes.length / bytesPerFrame - startFrame;
                    const seekSeconds = startTimesSeconds[index]! + startFrame / track.timescale;
                    concatDocs.splice(0, index + 1, { ...source!, durationSeconds: duration / track.timescale,
                      duration: Math.round(duration / track.timescale * source!.timescale),
                      tracks: [{ ...track, samples, duration, editList: undefined }] });
                    startTimesSeconds.splice(0, index + 1, seekSeconds);
                    for (let i = 0; i < startTimesSeconds.length; i++) startTimesSeconds[i]! -= seekSeconds;
                    concatInputSeek = true;
                  }
                }
                // Concat starts at zero even when the first file retains negative preroll.
                const document = { ...concatMp4(concatDocs, { startTimesSeconds, limits: options.limits, budget }), chapters, containerFormat: "concat" };
                if (input?.startSeconds !== undefined && input.startSeconds > 0 && !seekable) {
                  if (logLevel >= 24) await writeBytes(context.stderr,
                    encodeUtf8(`ffmpeg: could not seek to position ${input.startSeconds.toFixed(3)}\n`), context.signal);
                  const track = concatDocs[0]?.tracks[0];
                  const packet = track?.samples[0];
                  if (track && packet && concatDocs[0]?.containerFormat === "wav" &&
                    track.codecDescriptions[0]?.codecName?.startsWith("pcm_")) {
                    // Seeking flushes the packet buffered by stream probing even
                    // when the demuxer cannot seek. Stream copy resumes there;
                    // decoding still discards samples before the requested time.
                    const probeEnd = (packet.dts + packet.duration) / track.timescale;
                    concatInputSeek = true;
                    return sliceMp4(document, {
                      startSeconds: audioCodec === "copy" ? probeEnd : Math.max(probeEnd, input.startSeconds),
                      copyAudio: audioCodec === "copy"
                    });
                  }
                }
                return document;
              }

              const plugin = explicitFormat !== undefined
                ? registry.findByFormatName(explicitFormat)
                : registry.detect(rawBytes, filePath);
              if (!plugin || !plugin.canDemux) {
                throw new Error(
                  explicitFormat
                    ? `Unknown input format: '${explicitFormat}' (AST not registered)`
                    : `${filePath}: Unsupported input format (AST not registered)`
                );
              }

              // FFmpeg rejects explicit zero-size AU inputs; ffprobe still accepts them.
              if (plugin.id === "au" && rawBytes.length >= 12 &&
                new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength).getUint32(8) === 0) {
                throw new Error(`${filePath}: Invalid AU data size`);
              }

              const resolveResource = await loadManifestResources(plugin, rawBytes, filePath, context.cwd, readInput, budget, input?.allowedExtensions);
              const document = plugin.parse(rawBytes, {
                seekable: !isStdin(filePath),
                decodeSubtitles: subtitleCodec !== "copy",
                decodeAudio: audioCodec !== "copy" || !(["flac", "ogg", "wav", "w64", "aiff", "wv", "mp4", "mov", "latm"].includes(plugin.id) || plugin.supportedAudioCodecs.includes(`pcm_${plugin.id}`)),
                resolveResource,
                webvttKind: input?.webvttKind,
                subtitleFrameRate: input?.subtitleFrameRate,
                sampleRate: input?.sampleRate,
                channels: input?.channels,
                ignoreLength: input?.ignoreLength,
                maxSize: input?.maxSize,
                filename: filePath,
                limits: options.limits,
                budget
              });
              if (plugin.id === "aac" && audioCodec === "copy" && checksumOutput) {
                // Checksum muxers receive original ADTS packets; container muxers
                // and decoders continue to receive raw AAC access units.
                const packets = parseAdtsStream(rawBytes, true).frames;
                return { ...document, tracks: document.tracks.map(track => {
                  const timescale = 28224000; // FFmpeg's ADTS clock covers every AAC sample rate.
                  const scale = timescale / track.timescale;
                  return { ...track, timescale, duration: track.duration * scale,
                    samples: track.samples.map((sample, index) => ({ ...sample,
                      data: packets[index]!, size: packets[index]!.length,
                      dts: sample.dts * scale, pts: sample.pts * scale,
                      cts: sample.cts * scale, duration: sample.duration * scale
                    })) };
                }) };
              }
              if (!ignoreEditList || (plugin.id !== "mp4" && plugin.id !== "mov")) return document;
              const tracks = document.tracks.map(track => ({ ...track, editList: undefined,
                duration: track.samples.reduce((end, sample) => Math.max(end, sample.dts + sample.duration), 0)
              }));
              const durationSeconds = Math.max(0, ...tracks.map(track => track.duration / track.timescale));
              return { ...document, tracks, durationSeconds, duration: Math.round(durationSeconds * document.timescale) };
            };

            // Resolve output AST plugin from `outputFormat` or `outputTarget` filename
            const outPlugin = outputFormat
              ? (registry.findById(outputFormat) ?? registry.findByFormatName(outputFormat))
              : registry.findByFilename(outputTarget);

            // Load all inputs and apply per-input slicing / looping
            const loadedDocs: MediaDocument[] = [];
            const inputStarts: (number | undefined)[] = [];
            let demuxExitCode = 0;
            for (const inp of inputs) {
              await yieldTurn(context.signal);
              context.signal.throwIfAborted();
              concatInputSeek = false;
              let doc = await loadSingleDocument(inp.path, inp.format, inp.fps, inp);
              if (!dumpedInputs.has(inp)) {
                for (const [specifier, filename] of inp.dumpAttachments ?? []) {
                  const [selector, ordinal] = specifier.split(":");
                  const type = selector === "v" ? "video" : selector === "a" ? "audio"
                    : selector === "s" ? "subtitle" : selector === "d" ? "data" : undefined;
                  let streams: readonly (MediaTrack | MediaAttachment)[] = type ? doc.tracks.filter(track => track.type === type)
                    : selector === "t" ? doc.attachments ?? [] : [...doc.tracks, ...doc.attachments ?? []];
                  const index = type || selector === "t" ? ordinal : selector;
                  if (index) streams = streams.filter((_, ordinal) => ordinal === Number(index));
                  for (const stream of streams) {
                    const description = "samples" in stream ? stream.codecDescriptions[0] : undefined;
                    const bytes = "samples" in stream
                      ? description?.extraData ?? description?.avcC?.rawBytes ?? description?.hvcC?.rawBytes
                        ?? description?.av1C?.rawBytes ?? description?.esds?.decoderSpecificInfo
                      : stream.data;
                    if (!bytes?.length) continue;
                    budget.checkOutputBytes(bytes.byteLength);
                    const destination = filename || ("samples" in stream ? stream.metadata?.filename : stream.tags.filename);
                    if (!destination) throw new Error("No filename specified for attachment");
                    if (isStdout(destination)) await writeBytes(context.stdout, bytes, context.signal);
                    else {
                      const path = resolvePath(context.cwd, destination);
                      if (!overwrite) {
                        let exists = true;
                        try { await context.fs.stat(path, { signal: context.signal }); }
                        catch (error) {
                          rethrowRuntimeError(context, error);
                          if ((error as { code?: string }).code !== "ENOENT") throw error;
                          exists = false;
                        }
                        if (exists) throw new Error(`File '${destination}' already exists. Exiting.`);
                      }
                      await writeFileOutput(context, bytes, data => context.fs.writeFile(path, data, { signal: context.signal }));
                    }
                  }
                }
                dumpedInputs.add(inp);
              }
              if (doc.containerFormat === "dash") {
                // FFmpeg subtracts one input start time, including AAC priming,
                // from every representation before copying its packets.
                const offsets = doc.tracks.map(track => {
                  let offset = 0;
                  for (const edit of track.editList ?? []) {
                    if (edit.mediaTime < 0) offset += edit.segmentDuration / doc.timescale;
                    else { offset -= edit.mediaTime / track.timescale; break; }
                  }
                  return offset;
                });
                // The native DASH demuxer schedules by the previous packet PTS
                // and returns EOF when the next scheduled representation ends.
                const positions = doc.tracks.map(() => 0);
                const timestamps = doc.tracks.map(() => 0);
                for (;;) {
                  budget.checkCpu();
                  let index = 0;
                  for (let i = 1; i < timestamps.length; i++) {
                    if (timestamps[i]! < timestamps[index]!) index = i;
                  }
                  const track = doc.tracks[index]!;
                  const sample = track.samples[positions[index]!];
                  if (!sample) break;
                  positions[index]!++;
                  timestamps[index] = Math.round((sample.pts / track.timescale + offsets[index]!) * 90000);
                }
                const start = Math.min(...doc.tracks.map((track, index) =>
                  (track.samples[0]?.pts ?? 0) / track.timescale + offsets[index]!));
                const tracks = doc.tracks.map((track, index) => {
                  const firstDts = track.samples[0]?.dts ?? 0;
                  const delay = Math.round(firstDts + (offsets[index]! - start) * track.timescale);
                  const samples = track.samples.slice(0, positions[index]);
                  const lastSample = samples[samples.length - 1];
                  const mediaDuration = lastSample ? lastSample.dts + lastSample.duration - firstDts : 0;
                  // MP4's default movie clock is milliseconds; empty edits round
                  // down after timestamps have been rounded to the track clock.
                  const emptyDuration = Math.max(0, Math.floor(delay * 1000 / track.timescale));
                  return { ...track,
                    samples: samples.map(sample => ({ ...sample, dts: sample.dts - firstDts, pts: sample.pts - firstDts })),
                    duration: mediaDuration + Math.round(emptyDuration * track.timescale / 1000),
                    editList: [
                      ...(emptyDuration ? [{ segmentDuration: emptyDuration, mediaTime: -1, mediaRateInteger: 1, mediaRateFraction: 0 }] : []),
                      { segmentDuration: Math.round(mediaDuration * 1000 / track.timescale), mediaTime: Math.max(0, -delay), mediaRateInteger: 1, mediaRateFraction: 0 }
                    ]
                  };
                });
                doc = { ...doc, timescale: 1000, duration: Math.round(doc.durationSeconds * 1000), tracks };
              }
              for (const track of doc.tracks) {
                if (track.demuxError && (exitOnError || doc.containerFormat === "yuv4mpegpipe")) {
                  await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${track.demuxError.message}\n`), context.signal);
                }
              }
              if (exitOnError) {
                for (const track of doc.tracks) {
                  if (!track.demuxError) continue;
                  demuxExitCode = 183;
                  const end = track.demuxError.timestamp;
                  doc = { ...doc, tracks: doc.tracks.map(candidate => candidate !== track ? candidate : {
                    ...track, duration: end, decodeErrors: undefined,
                    samples: track.samples.filter(sample => sample.dts < end),
                    ...(track.decodedAudio ? { decodedAudio: { ...track.decodedAudio,
                      channelData: track.decodedAudio.channelData.map(channel => channel.slice(0, end))
                    } } : {})
                  }) };
                }
              }
              if (inp.ignoreLoop === false && doc.containerFormat === "gif") {
                const track = doc.tracks.find(track => track.type === "video");
                const loop = track?.gifLoop;
                const frames = track?.decodedVideoFrames;
                if (loop !== undefined && loop !== 1 && frames?.length && doc.durationSeconds > 0) {
                  const endSeconds = Math.min(
                    inp.durationSeconds !== undefined ? (inp.startSeconds ?? 0) + inp.durationSeconds : inp.endSeconds ?? Infinity,
                    (inp.startSeconds ?? 0) + (outputDuration !== undefined ? (outputSs ?? 0) + outputDuration : outputTo ?? Infinity),
                    maxVideoFrames !== undefined ? (inp.startSeconds ?? 0) + (outputSs ?? 0) + (outputFps ? maxVideoFrames / outputFps : Math.ceil(maxVideoFrames / frames.length) * doc.durationSeconds) : Infinity
                  );
                  const copies = Math.min(loop === 0 ? Infinity : loop, Math.max(1, Math.ceil(endSeconds / doc.durationSeconds)));
                  if (!Number.isFinite(copies)) throw new Error("-ignore_loop 0 requires a finite frame count or duration for an infinite GIF");
                  budget.checkConcatInputs(copies);
                  budget.checkDuration(copies * doc.durationSeconds);
                  doc = concatMp4(Array.from({ length: copies }, () => doc), { limits: options.limits, budget });
                }
              }
              if (inp.imageLoop) {
                const fps = inp.fps ?? 25;
                const endSeconds = Math.min(
                  inp.durationSeconds !== undefined ? (inp.startSeconds ?? 0) + inp.durationSeconds : inp.endSeconds ?? Infinity,
                  (inp.startSeconds ?? 0) + (outputDuration !== undefined ? (outputSs ?? 0) + outputDuration : outputTo ?? Infinity),
                  maxVideoFrames !== undefined ? (inp.startSeconds ?? 0) + (outputSs ?? 0) + maxVideoFrames / (outputFps ?? fps) : Infinity
                );
                if (!Number.isFinite(endSeconds)) {
                  throw new Error("-loop 1 requires a finite frame count or duration");
                }
                budget.checkDuration(endSeconds);
                const frameCount = Math.max(0, Math.ceil(endSeconds * fps));
                doc = {
                  ...doc,
                  duration: Math.round(frameCount / fps * doc.timescale),
                  durationSeconds: frameCount / fps,
                  tracks: await mapWork(doc.tracks, async track => {
                    if (track.type !== "video") return track;
                    const source = track.decodedVideoFrames;
                    if (!source?.length) throw new Error("-loop requires decoded image input");
                    const frames: MediaVideoFrame[] = [];
                    for (let index = 0; index < frameCount; index++) {
                      if (index % 64 === 0) await yieldTurn(context.signal);
                      context.signal.throwIfAborted();
                      const frame = source[index % source.length]!;
                      budget.recordFrame(frame.width, frame.height);
                      frames.push({ ...frame, ptsSeconds: index / fps, durationSeconds: 1 / fps });
                    }
                    return { ...track, duration: Math.round(frameCount / fps * track.timescale), samples: [], decodedVideoFrames: frames };
                  }, context.signal)
                };
              }
              const sourceStart = inputStartTime(doc, budget, outPlugin?.id);
              inputStarts.push(sourceStart);
              if ((videoCodec === "copy" || audioCodec === "copy") && (!copyTimestamps || startAtZero)) doc = shiftTimestamps(doc, -(sourceStart ?? 0), budget);
              doc = scaleInputTimestamps(doc, inp.timestampScales, budget);
              doc = applyInputDisplayTransforms(doc, inp.displayTransforms);
              if (inp.guessLayoutMax !== undefined) {
                doc = { ...doc, tracks: doc.tracks.map(track => {
                  const codec = track.codecDescriptions[0];
                  const fmt = codec?.rawWavFormatBytes;
                  if (track.type !== "audio" || !fmt || !codec.channels || codec.channels <= inp.guessLayoutMax! ||
                      codec.channelLayout || track.decodedAudio?.channelMask) return track;
                  const view = new DataView(fmt.buffer, fmt.byteOffset, fmt.byteLength);
                  if (fmt.length >= 24 && view.getUint16(0, true) === 0xfffe && view.getUint32(20, true)) return track;
                  // Preserve an unknown WAV layout independently of its channel count.
                  return { ...track, codecDescriptions: track.codecDescriptions.map(description => ({ ...description,
                    channelLayout: `${description.channels} channels`
                  })) };
                }) };
              }
              if (inp.subtitleCharset !== undefined && subtitleCodec !== "copy" && inp.subtitleCharencMode !== "ignore" && inp.subtitleCharencMode !== "do_nothing") doc = recodeSubtitles(doc, inp.subtitleCharset);
              if (inp.fixSubDuration && subtitleCodec !== "copy") doc = fixSubtitleDurations(doc);
              const startSeconds = inp.startSeconds ?? (inp.endRelativeSeconds === undefined
                ? undefined : Math.max(0, doc.durationSeconds + inp.endRelativeSeconds));
              if (audioCodec !== "copy" && !stripAudio) doc = decodeAacInput(doc);
              if (inp.streamLoop && inp.streamLoop > 0) {
                const copies = Array.from({ length: inp.streamLoop + 1 }, () => doc);
                doc = concatMp4(copies, { limits: options.limits, budget });
              }
              if (
                startSeconds !== undefined ||
                inp.endSeconds !== undefined ||
                inp.durationSeconds !== undefined
              ) {
                const rawTrack = doc.tracks[0];
                const rawCodec = rawTrack?.codecDescriptions[0];
                const packetFrames = rawTrack?.samples[0]?.duration;
                if (doc.containerFormat === "wav" && rawTrack?.decodedAudio && packetFrames &&
                    rawCodec?.codecName?.startsWith("pcm_") && !isStdin(inp.path) && !concatInputSeek &&
                    startSeconds !== undefined && startSeconds > 0) {
                  // Seeking a WAV starts a full packet at the selected sample, before filtering.
                  const bytesPerFrame = rawTrack.samples[0]!.data.length / packetFrames;
                  const bytes = concatBytes(rawTrack.samples.map(sample => sample.data));
                  const samples: MediaTrack["samples"][number][] = [];
                  for (let frame = Math.round(startSeconds * rawTrack.timescale);
                    frame * bytesPerFrame < bytes.length; frame += packetFrames) {
                    budget.checkCpu();
                    const data = bytes.subarray(frame * bytesPerFrame, (frame + packetFrames) * bytesPerFrame);
                    samples.push({ data, dts: frame, pts: frame, cts: 0, size: data.length,
                      duration: data.length / bytesPerFrame, isKeyframe: true, sampleDescriptionIndex: 1 });
                  }
                  doc = { ...doc, tracks: [{ ...rawTrack, samples }] };
                }
                const rawSeek = rawCodec !== undefined && startSeconds !== undefined && startSeconds > 0 &&
                  (audioCodec === "copy" || startSeconds > doc.durationSeconds) &&
                  (rawCodec?.codecName === `pcm_${doc.containerFormat}` ||
                    (doc.containerFormat === "au" && rawCodec?.codecName?.startsWith("pcm_")));
                if (rawSeek) {
                  // Raw PCM and AU input seeks start a new packet at the exact sample frame.
                  const bytes = concatBytes(rawTrack!.samples.map(sample => sample.data));
                  const requestedOffset = Math.round(startSeconds * rawCodec.sampleRate!) *
                    rawCodec.channels! * rawCodec.bitsPerSample! / 8;
                  // Failed seeks beyond EOF leave the raw demuxer at its last packet.
                  const offset = requestedOffset > bytes.length
                    ? bytes.length - (rawTrack!.samples.at(-1)?.data.length ?? 0) : requestedOffset;
                  doc = { ...registry.findByFormatName(rawCodec.codecName!.slice(4))!.parse(bytes.subarray(offset), {
                    sampleRate: rawCodec.sampleRate, channels: rawCodec.channels, decodeAudio: audioCodec !== "copy", budget
                  }), containerFormat: doc.containerFormat, metadata: doc.metadata };
                }
                // An empty raw seek is already sliced; retain its PCM codec and decoded audio.
                if (!rawSeek || doc.durationSeconds > 0) doc = sliceMp4(doc, {
                  inputSeek: startSeconds !== undefined,
                  startSeconds: rawSeek || concatInputSeek ? 0 : startSeconds,
                  endSeconds: (rawSeek || concatInputSeek) && inp.endSeconds !== undefined ? inp.endSeconds - startSeconds! : inp.endSeconds,
                  durationSeconds: inp.durationSeconds,
                  copyAudio: audioCodec === "copy"
                });
                if (videoCodec === "copy" && !copyPriorStart && startSeconds !== undefined) doc = discardOutputPreroll(doc, { video: videoCodec }, copyInitialNonKeyframes);
              }
              if (inp.streamLoop === -1) {
                doc = loopToOutputEnd(doc, outputDuration === undefined ? outputTo : (outputSs ?? 0) + outputDuration, budget);
              }
              if (subtitleCodec !== "copy" && inp.subtitleCharencMode !== "ignore") doc = validateSubtitleText(doc, exitOnError);
              loadedDocs.push(shiftTimestamps(doc, inp.timestampOffset ?? 0, budget));
            }

            synchronizeInputs(loadedDocs, inputs, inputStarts, copyTimestamps, startAtZero, budget);

            if (outPlugin?.id === "image2" && outputStartNumber !== undefined && outputStartNumber > 2147483647) {
              throw new Error("invalid start_number: expected an integer from 0 to 2147483647");
            }
            // Combine inputs according to `-filter_complex`, `-map`, or default mux
            let workingDoc: MediaDocument;
            let audioOrdinal = 0;
            let audioSinks: { track: MediaTrack; expression: string }[] = [];
            const feedback = filterComplex ? parseFeedbackGraph(filterComplex, maps) : undefined;
            if (filterComplex) {
              if (features.filterGraph === false) {
                throw new Error("Filtergraph processing is disabled by consumer feature configuration");
              }
              if (feedback) {
                if (features.videoTranscode === false) throw new Error("Video transcoding is disabled by consumer feature configuration");
                if (vfFilters.length) throw new Error("feedback: cannot combine simple and complex video filters");
                const doc = loadedDocs[feedback.input];
                const track = doc?.tracks.filter(track => track.type === "video")[feedback.ordinal];
                if (!doc || !track) throw new Error("feedback: video input is unavailable");
                workingDoc = { ...doc, tracks: [track] };
                vfFilters.push("null");
              } else if (filterComplex.includes("showwavespic")) {
                let expression = filterComplex.trim();
                let input = "0:a:0";
                if (expression.startsWith("[")) {
                  const end = expression.indexOf("]");
                  input = expression.slice(1, end);
                  expression = expression.slice(end + 1);
                }
                if (expression.endsWith("]")) {
                  const start = expression.lastIndexOf("[");
                  const label = expression.slice(start + 1, -1);
                  if (maps.length !== 1 || maps[0] !== `[${label}]` || mappedAudioLabels.has(label)) {
                    throw new Error("showwavespic: output label must be mapped exactly once");
                  }
                  mappedAudioLabels.add(label);
                  expression = expression.slice(0, start);
                } else if (maps.length) throw new Error("showwavespic: unsupported output map");
                const [index, type, ordinal = "0", ...extra] = input.split(":");
                const doc = loadedDocs[Number(index)];
                const track = type === "a" && index !== "" && extra.length === 0
                  ? doc?.tracks.filter(track => track.type === "audio")[Number(ordinal)] : undefined;
                if (!doc || !track) throw new Error(`showwavespic: invalid audio input ${input}`);
                const audio = track.decodedAudio ?? (track.codecDescriptions[0]?.codecName === "aac"
                  ? decodeAacTrack(doc, track) : undefined);
                if (!audio) throw new Error("showwavespic requires decoded PCM audio");
                const filters = parseFilterChain(expression);
                const frame = await renderShowwavespic(audio, filters.shift() ?? "", budget, context.signal);
                vfFilters.push(...filters);
                workingDoc = { ...doc, duration: doc.timescale, durationSeconds: 1, tracks: [{
                  id: 1, type: "video", handlerType: "vide", timescale: 1, duration: 1,
                  language: "und", enabled: true, width: frame.width, height: frame.height,
                  codecDescriptions: [], samples: [], decodedVideoFrames: [frame]
                }] };
              } else if (filterComplex.includes("concat=")) {
                workingDoc = concatMp4(loadedDocs, { limits: options.limits, budget });
                if (/concat=[^;[]*\ba=0\b/.test(filterComplex)) {
                  workingDoc = {
                    ...workingDoc,
                    tracks: workingDoc.tracks.filter((t) => t.type !== "audio")
                  };
                }
                if (/concat=[^;[]*\bv=0\b/.test(filterComplex)) {
                  workingDoc = {
                    ...workingDoc,
                    tracks: workingDoc.tracks.filter((t) => t.type !== "video")
                  };
                }
              } else if (filterComplex.includes("freezeframes")) {
                let expression = filterComplex.trim();
                const selected: { doc: MediaDocument; track: MediaTrack }[] = [];
                for (let i = 0; i < 2; i++) {
                  let inputIndex = i;
                  let streamIndex = 0;
                  if (expression.startsWith("[")) {
                    const end = expression.indexOf("]");
                    const label = expression.slice(1, end);
                    const parts = label.split(":");
                    if (end < 0 || parts.length > 3 || parts[1] !== "v" ||
                        !parts[0] || ![...parts[0]].every(char => char >= "0" && char <= "9") ||
                        (parts[2] !== undefined && (!parts[2] || ![...parts[2]].every(char => char >= "0" && char <= "9")))) {
                      throw new Error(`freezeframes: invalid input label ${label}`);
                    }
                    inputIndex = Number(parts[0]);
                    streamIndex = Number(parts[2] ?? 0);
                    expression = expression.slice(end + 1).trim();
                  }
                  const doc = loadedDocs[inputIndex];
                  const track = doc?.tracks.filter(track => track.type === "video")[streamIndex];
                  if (!doc || !track) throw new Error(`freezeframes: input ${inputIndex}:v:${streamIndex} is unavailable`);
                  selected.push({ doc, track });
                }
                if (expression.endsWith("]")) {
                  const start = expression.lastIndexOf("[");
                  const label = expression.slice(start + 1, -1);
                  if (maps.length !== 1 || maps[0] !== `[${label}]`) {
                    throw new Error("freezeframes: output label must be mapped exactly once");
                  }
                  expression = expression.slice(0, start);
                } else if (maps.length) throw new Error("freezeframes: unsupported output map");
                const filters = parseFilterChain(expression);
                const spec = filters.shift()!;
                const [name, ...args] = spec.split("=");
                if (name !== "freezeframes") throw new Error("freezeframes: unsupported input graph");
                const values = { first: 0, last: 0, replace: 0 };
                const keys = ["first", "last", "replace"] as const;
                for (const [index, option] of (args.length ? args.join("=").split(":") : []).entries()) {
                  const equal = option.indexOf("=");
                  const key = equal < 0 ? keys[index] : option.slice(0, equal).trim();
                  const value = equal < 0 ? option.trim() : option.slice(equal + 1).trim();
                  if (key !== "first" && key !== "last" && key !== "replace") {
                    throw new Error(`freezeframes: unsupported option ${key ?? option}`);
                  }
                  const number = Number(value);
                  if (!value || !Number.isSafeInteger(number) || number < 0) {
                    throw new Error(`freezeframes: ${key} must be a nonnegative integer`);
                  }
                  values[key] = number;
                }
                if (values.first > values.last) throw new Error("freezeframes: first must not exceed last");
                const source = selected[0]!;
                const donor = selected[1]!;
                const frames = await ensureDecodedFrames(source.track, source.doc.timescale, budget, context.signal);
                const replacements = await ensureDecodedFrames(donor.track, donor.doc.timescale, budget, context.signal, values.replace + 1);
                const replacement = replacements[values.replace];
                if (!replacement) throw new Error("freezeframes: replacement frame is unavailable");
                if (frames.some(frame => frame.width !== replacement.width || frame.height !== replacement.height)) {
                  throw new Error("freezeframes: input dimensions must match");
                }
                vfFilters.push(...filters);
                workingDoc = { ...source.doc, tracks: [{ ...source.track, samples: [],
                  decodedVideoFrames: await mapWork(frames, (frame, index) => {
                    if (index < values.first || index > values.last) return frame;
                    budget.recordFrame(replacement.width, replacement.height);
                    budget.allocateMemory(replacement.data.byteLength);
                    // MP4 encoding consumes each frame's pixel buffer.
                    return { ...replacement, data: new Uint8Array(replacement.data),
                      ptsSeconds: frame.ptsSeconds, durationSeconds: frame.durationSeconds };
                  }, context.signal)
                }] };
              } else if (filterComplex.includes("xfade") && loadedDocs.length >= 2) {
                let pads = filterComplex.slice(0, filterComplex.indexOf("xfade")).trim();
                const selected = [0, 1].map(defaultIndex => {
                  let inputIndex = defaultIndex;
                  let streamIndex = 0;
                  if (pads.startsWith("[")) {
                    const end = pads.indexOf("]");
                    const label = pads.slice(1, end);
                    const parts = label.split(":");
                    if (end < 0 || parts.length > 3 || parts[1] !== "v" ||
                        !parts[0] || ![...parts[0]].every(char => char >= "0" && char <= "9") ||
                        (parts[2] !== undefined && (!parts[2] || ![...parts[2]].every(char => char >= "0" && char <= "9")))) {
                      throw new Error(`xfade: invalid input label ${label}`);
                    }
                    inputIndex = Number(parts[0]);
                    streamIndex = Number(parts[2] ?? 0);
                    pads = pads.slice(end + 1).trim();
                  }
                  const doc = loadedDocs[inputIndex];
                  const track = doc?.tracks.filter(t => t.type === "video")[streamIndex];
                  if (!doc || !track) throw new Error(`xfade: input ${inputIndex}:v:${streamIndex} is unavailable`);
                  return { doc, track, input: inputs[inputIndex]! };
                });
                if (pads) throw new Error(`xfade: unsupported input labels ${pads}`);
                const [first, second] = [selected[0]!, selected[1]!];
                const f0 = await ensureDecodedFrames(first.track, first.doc.timescale, budget, context.signal);
                const f1 = await ensureDecodedFrames(second.track, second.doc.timescale, budget, context.signal);
                if (f0[0] && f1[0]) {
                  if (f0[0].width !== f1[0].width || f0[0].height !== f1[0].height) {
                    throw new Error(`xfade input size ${f0[0].width}x${f0[0].height} does not match ${f1[0].width}x${f1[0].height}`);
                  }
                  // Lavfi's timebase is its frame interval, not the synthetic MP4 timescale.
                  const timebase0 = first.input.format === "lavfi" ? f0[0].durationSeconds : 1 / first.track.timescale;
                  const timebase1 = second.input.format === "lavfi" ? f1[0].durationSeconds : 1 / second.track.timescale;
                  if (timebase0 !== timebase1) {
                    throw new Error(`xfade input timebase ${timebase0} does not match ${timebase1}`);
                  }
                }
                const xfadeSpec = filterComplex.slice(filterComplex.indexOf("xfade") + "xfade".length)
                  .split("[")[0]!.split(",")[0]!.split(";")[0]!.trim();
                const positional = (xfadeSpec.startsWith("=") ? xfadeSpec.slice(1) : "").split(":");
                const named: Record<string, string> = {};
                for (const [index, part] of positional.entries()) {
                  const eqIdx = part.indexOf("=");
                  if (!part && positional.length === 1) continue;
                  const key = eqIdx >= 0 ? part.slice(0, eqIdx).trim() : ["transition", "duration", "offset"][index];
                  if (key !== "transition" && key !== "duration" && key !== "offset") {
                    throw new Error(`xfade: unsupported option ${key ?? part}`);
                  }
                  named[key] = (eqIdx >= 0 ? part.slice(eqIdx + 1) : part).trim();
                }
                const transition = named.transition ?? "fade";
                if (transition !== "fade" && transition !== "wipeleft") {
                  throw new Error(`Unsupported xfade transition: ${transition}`);
                }
                const fadeDur = parseHlsDuration(named.duration ?? "1");
                if (!Number.isFinite(fadeDur) || fadeDur < 0 || fadeDur > 60) {
                  throw new Error("xfade: duration must be in the range [0, 60]");
                }
                const fps = f0[0]?.durationSeconds ? Math.round(1 / f0[0].durationSeconds) : 25;
                const offsetSec = parseHlsDuration(named.offset ?? "0");
                const preCount = Math.max(0, Math.min(f0.length, Math.round(offsetSec * fps)));
                const elapsedFrames = Math.max(0, -Math.round(offsetSec * fps));
                const overlapFrames = fadeDur === 0 ? 0 : Math.min(f0.length - preCount, f1.length, Math.max(0, Math.max(1, Math.round(fadeDur * fps)) - elapsedFrames));
                const outFrames: MediaVideoFrame[] = [];
                let cursor = 0;
                for (let i = 0; i < preCount; i++) {
                  const f = f0[i]!;
                  outFrames.push({ ...f, ptsSeconds: cursor });
                  cursor += f.durationSeconds;
                }
                for (let k = 0; k < overlapFrames; k++) {
                  const a = f0[Math.min(f0.length - 1, preCount + k)]!;
                  const b = f1[Math.min(f1.length - 1, k)]!;
                  const progress = Math.min(1, (elapsedFrames + k) / (fadeDur * fps));
                  const blended = new Uint8Array(a.data.byteLength);
                  for (let pIdx = 0; pIdx < blended.byteLength; pIdx += 4) {
                    const alpha = transition === "wipeleft"
                      ? ((pIdx / 4) % a.width > Math.floor(a.width * (1 - progress)) ? 1 : 0)
                      : progress;
                    blended[pIdx] = Math.round(a.data[pIdx]! * (1 - alpha) + b.data[pIdx]! * alpha);
                    blended[pIdx + 1] = Math.round(a.data[pIdx + 1]! * (1 - alpha) + b.data[pIdx + 1]! * alpha);
                    blended[pIdx + 2] = Math.round(a.data[pIdx + 2]! * (1 - alpha) + b.data[pIdx + 2]! * alpha);
                    blended[pIdx + 3] = 255;
                  }
                  outFrames.push({
                    width: a.width,
                    height: a.height,
                    data: blended,
                    ptsSeconds: cursor,
                    durationSeconds: a.durationSeconds,
                    keyframe: true
                  });
                  cursor += a.durationSeconds;
                }
                // If the first clip ends before the transition starts, FFmpeg forwards
                // the second clip at its original timestamps; output sync handles overlap.
                if (preCount === f0.length) cursor = f1[0]?.ptsSeconds ?? 0;
                for (let j = overlapFrames; j < f1.length; j++) {
                  const b = f1[j]!;
                  outFrames.push({ ...b, ptsSeconds: cursor });
                  cursor += b.durationSeconds;
                }
                workingDoc = {
                  ...loadedDocs[0]!,
                  durationSeconds: cursor,
                  tracks: loadedDocs[0]!.tracks.map((t) =>
                    t.type === "video" ? { ...t, samples: [], decodedVideoFrames: outFrames } : t
                  )
                };
              } else if ((filterComplex.includes("vstack") || filterComplex.includes("hstack") || filterComplex.includes("framepack")) && loadedDocs.length >= 2) {
                const framepack = filterComplex.includes("framepack");
                let vertical = filterComplex.includes("vstack");
                const filter = framepack ? "framepack" : vertical ? "vstack" : "hstack";
                const spec = filterComplex.slice(filterComplex.indexOf(filter) + filter.length)
                  .split("[")[0]!.split(",")[0]!.split(";")[0]!.trim();
                const options = (spec.startsWith("=") ? spec.slice(1) : "").split(":");
                if (framepack) {
                  const option = options[0]?.trim() ?? "";
                  const layout = (option.startsWith("format=") ? option.slice(7) : option) || "sbs";
                  if (options.length !== 1 || !["sbs", "tab", "3", "4"].includes(layout)) {
                    throw new Error("framepack: supported formats are sbs and tab");
                  }
                  vertical = layout === "tab" || layout === "4";
                }
                const inputOption = options.find(option => option.trim().startsWith("inputs="))
                  ?.split("=")[1]?.trim() ?? (options[0]?.includes("=") ? undefined : options[0]?.trim());
                const inputCount = framepack ? 2 : Number(inputOption || 2);
                if (!Number.isInteger(inputCount) || inputCount < 2 || inputCount > loadedDocs.length) {
                  throw new Error(`${filter}: inputs must specify at least two available inputs`);
                }
                const inputs: MediaVideoFrame[][] = [];
                const inputTracks: MediaTrack[] = [];
                let pads = filterComplex.slice(0, filterComplex.indexOf(filter)).trim();
                for (let i = 0; i < inputCount; i++) {
                  let inputIndex = i;
                  let streamIndex = 0;
                  if (pads.startsWith("[")) {
                    const end = pads.indexOf("]");
                    const label = pads.slice(1, end);
                    const parts = label.split(":");
                    if (end < 0 || parts.length > 3 || parts[1] !== "v" ||
                        !parts[0] || ![...parts[0]].every(char => char >= "0" && char <= "9") ||
                        (parts[2] !== undefined && (!parts[2] || ![...parts[2]].every(char => char >= "0" && char <= "9")))) {
                      throw new Error(`${filter}: invalid input label ${label}`);
                    }
                    inputIndex = Number(parts[0]);
                    streamIndex = Number(parts[2] ?? 0);
                    pads = pads.slice(end + 1).trim();
                  }
                  const doc = loadedDocs[inputIndex];
                  const track = doc?.tracks.filter(t => t.type === "video")[streamIndex];
                  if (!doc || !track) throw new Error(`${filter}: input ${inputIndex}:v:${streamIndex} is unavailable`);
                  inputTracks.push(track);
                  inputs.push(await ensureDecodedFrames(track, doc.timescale, budget, context.signal));
                }
                if (pads) throw new Error(`${filter}: unsupported input labels ${pads}`);
                const shortestOption = options.find((option) => option.trim().startsWith("shortest="))
                  ?.split("=")[1]?.trim() ?? options[1]?.trim();
                const stopAtShortest = framepack || ["1", "true", "yes", "on"].includes(shortestOption ?? "0");
                const lengths = inputs.map(frames => frames.length);
                let count = stopAtShortest || lengths.includes(0)
                  ? Math.min(...lengths) : Math.max(...lengths);
                // Native framepack stops on decoder EOF before consuming the final
                // queued left frame. Generated sources deliver EOF after their last frame.
                if (framepack && !inputTracks[0]!.decodedVideoFrames) count = Math.max(0, Math.min(lengths[0]! - 1, lengths[1]!));
                const stacked: MediaVideoFrame[] = [];
                for (let i = 0; i < count; i++) {
                  const frames = inputs.map(input => input[Math.min(i, input.length - 1)]!);
                  const first = frames[0]!;
                  if (framepack && frames.some(frame => frame.width !== first.width || frame.height !== first.height ||
                      Math.abs(frame.durationSeconds - first.durationSeconds) > 1e-6)) {
                    throw new Error("framepack: inputs must have matching dimensions and frame rates");
                  }
                  const timing = inputs.find(input => input[i])![i]!;
                  const axis = vertical ? "width" : "height";
                  for (const [index, frame] of frames.entries()) {
                    if (frame[axis] !== first[axis]) {
                      throw new Error(`Input ${index} ${axis} ${frame[axis]} does not match input 0 ${axis} ${first[axis]}`);
                    }
                  }
                  const w = vertical ? first.width : frames.reduce((sum, frame) => sum + frame.width, 0);
                  const h = vertical ? frames.reduce((sum, frame) => sum + frame.height, 0) : first.height;
                  budget.recordFrame(w, h);
                  const outData = new Uint8Array(w * h * 4);
                  let offset = 0;
                  for (const frame of frames) {
                    for (let y = 0; y < frame.height; y++) {
                      outData.set(frame.data.subarray(y * frame.width * 4, (y + 1) * frame.width * 4),
                        (vertical ? (offset + y) * w : y * w + offset) * 4);
                    }
                    offset += vertical ? frame.height : frame.width;
                  }
                  stacked.push({
                    width: w,
                    height: h,
                    data: outData,
                    ptsSeconds: timing.ptsSeconds,
                    durationSeconds: timing.durationSeconds,
                    keyframe: true
                  });
                }
                workingDoc = {
                  ...loadedDocs[0]!,
                  tracks: loadedDocs[0]!.tracks.map((t) =>
                    t.type === "video"
                      ? {
                          ...t,
                          width: stacked[0]?.width ?? t.width,
                          height: stacked[0]?.height ?? t.height,
                          samples: [],
                          ...(framepack ? { codecDescriptions: [{ ...t.codecDescriptions[0]!, stereoMode: vertical ? 3 : 1 }] } : {}),
                          decodedVideoFrames: stacked
                        }
                      : t
                  )
                };
              } else if (filterComplex.includes("overlay") && loadedDocs.length >= 2) {
                const f0 = await ensureDecodedFrames(
                  loadedDocs[0]!.tracks.find((t) => t.type === "video")!,
                  loadedDocs[0]!.timescale, budget
                , context.signal);
                const f1 = await ensureDecodedFrames(
                  loadedDocs[1]!.tracks.find((t) => t.type === "video")!,
                  loadedDocs[1]!.timescale, budget
                , context.signal);
                const overlaySpec = filterComplex.slice(filterComplex.indexOf("overlay") + "overlay".length)
                  .split("[")[0]!.split(",")[0]!.split(";")[0]!.trim();
                const positional = (overlaySpec.startsWith("=") ? overlaySpec.slice(1) : "").split(":");
                const named: Record<string, string> = {};
                for (const part of positional) {
                  const eqIdx = part.indexOf("=");
                  if (eqIdx >= 0) named[part.slice(0, eqIdx).trim()] = part.slice(eqIdx + 1).trim();
                }
                const xExpression = named.x ?? (positional[0] && !positional[0].includes("=") ? positional[0] : "0");
                const yExpression = named.y ?? (positional[1] && !positional[1].includes("=") ? positional[1] : "0");
                const format = named.format ?? "yuv420";
                const horizontalGrid = format.startsWith("yuv420") || format.startsWith("yuv422") ? 2 : 1;
                const verticalGrid = format.startsWith("yuv420") ? 2 : 1;
                const stopAtShortest = named.shortest === "1" || named.eof_action === "endall";
                const mainFrames = stopAtShortest ? f0.slice(0, f1.length) : f0;
                const overlaid: MediaVideoFrame[] = mainFrames.map((a, idx) => {
                  const b = named.eof_action === "pass" || named.repeatlast === "0"
                    ? f1[idx] : f1[Math.min(idx, f1.length - 1)];
                  if (!b) return a;
                  const variables = {
                    main_w: a.width, main_h: a.height, overlay_w: b.width, overlay_h: b.height,
                    W: a.width, H: a.height, w: b.width, h: b.height
                  };
                  // FFmpeg rounds integer positions down to the output chroma grid, including negatives.
                  const ox = Math.floor(Math.trunc(parseFilterExpression(xExpression, "overlay", variables)) / horizontalGrid) * horizontalGrid;
                  const oy = Math.floor(Math.trunc(parseFilterExpression(yExpression, "overlay", variables)) / verticalGrid) * verticalGrid;
                  const outData = new Uint8Array(a.data);
                  for (let y = 0; y < b.height && oy + y < a.height; y++) {
                    if (oy + y < 0) continue;
                    for (let x = 0; x < b.width && ox + x < a.width; x++) {
                      if (ox + x < 0) continue;
                      const srcOff = (y * b.width + x) * 4;
                      const dstOff = ((oy + y) * a.width + (ox + x)) * 4;
                      const alpha = b.data[srcOff + 3]!;
                      if (alpha === 0) continue;
                      for (let channel = 0; channel < 3; channel++) {
                        outData[dstOff + channel] = Math.round(
                          (b.data[srcOff + channel]! * alpha + outData[dstOff + channel]! * (255 - alpha)) / 255
                        );
                      }
                      outData[dstOff + 3] = 255;
                    }
                  }
                  return { ...a, data: outData };
                });
                workingDoc = {
                  ...loadedDocs[0]!,
                  tracks: loadedDocs[0]!.tracks.map((t) =>
                    t.type === "video" ? { ...t, samples: [], decodedVideoFrames: overlaid } : t
                  )
                };
              } else {
                const audioGraph = loadedDocs.every(doc => doc.tracks.every(track => track.type === "audio")) ||
                  loadedDocs.some((_, index) => filterComplex?.includes(`[${index}:a`));
                if (audioGraph) {
                  if (afFilters.length) throw new Error("Cannot combine simple and complex audio filters");
                  const { outputs, sinks } = await resolveAudioGraph(filterComplex, loadedDocs, maps, audioOutputMaps, mappedAudioLabels, filterAudio, budget, context.signal);
                  audioSinks = sinks;
                  workingDoc = await muxMp4Cooperatively(
                    [{ ...loadedDocs[0]!, tracks: outputs.map(output => output.track) }],
                    { stripAudio, stripVideo, stripSubtitles }, context.signal);
                  afFilters.push(...outputs.map((output, ordinal) => ({ ordinal, expression: output.expression })));
                } else {
                  workingDoc = await muxMp4Cooperatively(loadedDocs, {}, context.signal);
                  const cleanedComplex = filterComplex.replace(/\[[^\]]+\]/g, "").trim();
                  if (cleanedComplex) vfFilters.push(cleanedComplex);
                }
              }
            } else if (maps.length > 0) {
              let selectedTracks: { input: number; track: MediaTrack | MediaAttachment }[] = [];
              let mapped = false;
              for (const map of maps) {
                const exclude = map.startsWith("-");
                let clean = exclude ? map.slice(1) : map;
                const optional = clean.endsWith("?");
                if (optional) clean = clean.slice(0, -1);
                if (clean.startsWith("[")) continue;
                const [input, ...specifier] = clean.split(":");
                const inputIdx = Number(input);
                const srcDoc = loadedDocs[inputIdx];
                if (!srcDoc) {
                  await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Invalid input file index: ${inputIdx}.\n`), context.signal);
                  return { exitCode: 234 };
                }
                const program = specifier[0] === "p"
                  ? srcDoc.programs?.find(program => program.programNumber === Number(specifier[1])) : undefined;
                const programMap = specifier[0] === "p";
                if (programMap) specifier.splice(0, 2);
                const selector = specifier[0];
                const type = selector === "v" ? "video" : selector === "a" ? "audio" : selector === "s" ? "subtitle" : selector === "d" ? "data" : undefined;
                let matches: readonly (MediaTrack | MediaAttachment)[] = type ? srcDoc.tracks.filter(t => t.type === type)
                  : selector === "t" ? srcDoc.attachments ?? [] : [...srcDoc.tracks, ...srcDoc.attachments ?? []];
                if (programMap) matches = matches.filter(track => "id" in track && program?.streamPids.includes(track.id));
                const streamSpecifier = type || selector === "t" ? specifier.slice(1) : specifier;
                const [index, key, ...valueParts] = streamSpecifier;
                if (index?.startsWith("#") || index === "i") {
                  const id = Number(index === "i" ? key : index.slice(1));
                  matches = matches.filter(track => "id" in track && track.id === id);
                } else if (index === "m") {
                  const value = valueParts.length ? valueParts.join(":") : undefined;
                  matches = matches.filter(track => "samples" in track && key === "language" &&
                    (value === undefined || track.language === value));
                } else if (index !== undefined) {
                  matches = matches.filter((_, i) => i === Number(index));
                }
                if ((matches.length === 0 || (exclude && !mapped)) && !optional) {
                  await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Stream map '${clean}' matches no streams.\nTo ignore this, add a trailing '?' to the map.\n`), context.signal);
                  return { exitCode: 234 };
                }
                if (exclude) {
                  selectedTracks = selectedTracks.filter(entry => entry.input !== inputIdx || !matches.includes(entry.track));
                } else {
                  mapped ||= matches.length > 0;
                  selectedTracks.push(...matches.map(track => ({ input: inputIdx, track })));
                }
              }
              if (stripData) {
                selectedTracks = selectedTracks.filter(({ track }) => !("samples" in track) || track.type !== "data");
              }
              if (outPlugin?.id === "mp4") {
                const streamIndex = selectedTracks.filter(({ track }) => !("samples" in track) ||
                  !(stripVideo && track.type === "video" || stripAudio && track.type === "audio" || stripSubtitles && track.type === "subtitle"))
                  .findIndex(({ track }) => "samples" in track && track.codecDescriptions[0]?.formatFourCC === "tmcd");
                if (streamIndex >= 0) {
                  await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Could not find tag for codec none in stream #${streamIndex}, codec not currently supported in container\n`), context.signal);
                  if (!isStdout(outputTarget) && outputTarget !== "/dev/null" && !outputTarget.startsWith("md5:")) {
                    await context.fs.writeFile(resolvePath(context.cwd, outputTarget), new Uint8Array(0), { signal: context.signal });
                  }
                  return { exitCode: 234 };
                }
              }
              if (!stripVideo && (outPlugin?.id === "mp4" || outPlugin?.id === "mov")) {
                for (const { input, track } of [...selectedTracks]) {
                  if (!("samples" in track) || track.type !== "video" || track.timecodeTrackId === undefined) continue;
                  const timecode = loadedDocs[input]!.tracks.find(candidate =>
                    candidate.id === track.timecodeTrackId && candidate.codecDescriptions[0]?.formatFourCC === "tmcd");
                  if (timecode && !selectedTracks.some(entry => entry.input === input && entry.track === timecode)) {
                    selectedTracks.push({ input, track: timecode });
                  }
                }
              }
              const streams = selectedTracks.map(({ input, track }) => {
                if (!("samples" in track) || !track.editList) return track;
                const scale = loadedDocs[0]!.timescale / loadedDocs[input]!.timescale;
                return { ...track, editList: track.editList.map(edit => ({
                  ...edit, segmentDuration: Math.round(edit.segmentDuration * scale)
                })) };
              });
              const filteredTracks = streams.filter((stream): stream is MediaTrack => "samples" in stream);
              const attachments = streams.filter((stream): stream is MediaAttachment => !("samples" in stream));
              if (!mapped) {
                // Ignored optional maps leave automatic video/audio selection enabled.
                const tracks = selectAutomaticStreams(loadedDocs).flatMap(doc => doc.tracks);
                for (const type of ["video", "audio"] as const) {
                  const track = tracks.find(track => track.type === type);
                  if (track) filteredTracks.push(track);
                }
              }

              workingDoc = await muxMp4Cooperatively(
                [{ ...loadedDocs[0]!, tracks: filteredTracks, attachments }],
                { stripAudio, stripVideo, stripSubtitles }
              , context.signal);
            } else {
              // Explicit maps retain their requested streams.
              if (subtitleCodec === undefined && (outPlugin?.id === "mp4" || outPlugin?.id === "mov")) stripSubtitles = true;
              workingDoc = await muxMp4Cooperatively(selectAutomaticStreams(loadedDocs), {
                stripAudio,
                stripVideo,
                stripSubtitles
              }, context.signal);
            }

            if (attachmentFiles.length) {
              if (outPlugin?.id !== "mkv") throw new Error("Attachments require Matroska output");
              const attachments = [...workingDoc.attachments ?? []];
              for (const filename of attachmentFiles) {
                const data = await readInput(filename);
                if (!data.length) throw new Error(`Attachment is empty: ${filename}`);
                attachments.push({ data, size: data.length, tags: { filename: filename.split("/").pop()! } });
              }
              workingDoc = { ...workingDoc, attachments };
            }
            if (workingDoc.attachments?.length) {
              const attachments = workingDoc.attachments.map((file, ordinal) => {
                const tags = { ...file.tags };
                for (const [specifier, key, value] of attachmentMetadata) {
                  const parts = specifier.split(":");
                  const index = parts[0] === "t" ? parts[1] : parts[0];
                  const current = parts[0] === "t" ? ordinal : workingDoc.tracks.length + ordinal;
                  if (!index || Number(index) === current) {
                    if (value) tags[key] = value;
                    else delete tags[key];
                  }
                }
                if (!tags.mimetype) throw new Error("Attachment requires mimetype metadata");
                if (!tags.filename) throw new Error("Attachment requires filename metadata");
                return { ...file, tags };
              });
              workingDoc = { ...workingDoc, attachments };
            }

            if (shortest) workingDoc = limitCopyPackets(workingDoc, [], { video: videoCodec, audio: audioCodec, subtitle: subtitleCodec }, true);

            if (workingDoc.tracks.length === 0 && !workingDoc.attachments?.length && outPlugin?.id !== "ffmetadata") {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Output file does not contain any stream.\n"), context.signal);
              return { exitCode: 234 };
            }
            validateAudioEncoder(audioCodec, workingDoc, astPlugins);
            if (subtitleCodec !== "copy") workingDoc = transcodeSubtitles(workingDoc,
              outPlugin?.id, subtitleCodec);

            const audioTrackCount = workingDoc.tracks.filter(track => track.type === "audio").length;
            if (audioCodec === "copy" && audioTrackCount > 0 && afFilters.some(filter => filter.ordinal === undefined || filter.ordinal < audioTrackCount)) {
              await writeBytes(context.stderr, encodeUtf8("ffmpeg: Filtering and streamcopy cannot be used together for audio.\n"), context.signal);
              return { exitCode: 218 };
            }

            // Apply output-level time slicing (`-ss`, `-to`, `-t`)
            if (
              outputSs !== undefined ||
              outputTo !== undefined ||
              outputDuration !== undefined
            ) {
              if (audioCodec === "copy" && outputSs !== undefined) {
                workingDoc = { ...workingDoc, tracks: workingDoc.tracks.map(track =>
                  workingDoc.containerFormat === "au" || track.codecDescriptions[0]?.codecName === `pcm_${workingDoc.containerFormat}`
                    ? { ...track, samples: track.samples.filter(sample => sample.pts >= outputSs * track.timescale) }
                    : track) };
              }
              const uncutTracks = workingDoc.tracks;
              workingDoc = sliceMp4(workingDoc, {
                startSeconds: outputSs,
                endSeconds: outputDuration === undefined ? outputTo : undefined,
                durationSeconds: outputDuration,
                copyAudio: audioCodec === "copy"
              });
              if (outputSs !== undefined) workingDoc = discardOutputPreroll(workingDoc, { video: videoCodec, audio: audioCodec }, copyInitialNonKeyframes);
              // Audio filters consume the input cut; output cuts consume their result.
              let audioOrdinal = 0;
              workingDoc = { ...workingDoc, tracks: workingDoc.tracks.map((track, index) => {
                if (track.type !== "audio") return track;
                const ordinal = audioOrdinal++;
                return afFilters.some(filter => filter.ordinal === undefined || filter.ordinal === ordinal)
                  ? uncutTracks[index]! : track;
              }) };
            }

            const streamFrameLimits = outputFrameLimits(workingDoc.tracks, frameLimits);
            workingDoc = limitCopyPackets(workingDoc, streamFrameLimits, { video: videoCodec, audio: audioCodec, subtitle: subtitleCodec });
            for (const type of ["video", "audio", "subtitle"] as const) {
              const limits = workingDoc.tracks.flatMap((track, index) => track.type === type ? [streamFrameLimits[index]] : []);
              const maximum = limits.some(limit => limit !== undefined) ? Math.max(...limits.map(limit => limit ?? Infinity)) : undefined;
              if (type === "video") maxVideoFrames = maximum;
              else if (type === "audio") maxAudioFrames = maximum;
              else maxSubtitleFrames = maximum;
            }
            const imagePipe = outputFormat === "image2pipe";
            const imageOutput = imagePipe || (outputFormat ? (registry.findById(outputFormat) ?? registry.findByFormatName(outputFormat)) : registry.findByFilename(outputTarget))?.id === "image2";
            const planeOutput = imageOutput && !imagePipe && outputTarget.endsWith(".Y") && (videoCodec === undefined || videoCodec === "rawvideo");
            const numberedImageOutput = !imagePipe && formatImageSequence(outputTarget, outputStartNumber ?? 1) !== undefined;
            if ((imageOutput || numberedImageOutput) && !planeOutput && videoCodec !== undefined && videoCodec !== "copy" && !imageEncoders.includes(videoCodec)) {
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Unknown encoder '${videoCodec}'\n`), context.signal);
              return { exitCode: 8 };
            }
            // Numbered image output applies -r during CFR synchronization, after video filters.
            if (outputSize && videoCodec !== "copy") {
              const [w, h] = outputSize.toLowerCase().split("x");
              if (w && h) vfFilters.push(`scale=${w}:${h}`);
            }
            if (outputFps && videoCodec !== "copy" && !numberedImageOutput) {
              vfFilters.push(`fps=${outputFps}`);
            }
            if (videoCodec !== "copy" && (rawPixelFormat === "gray" || rawPixelFormat === "gray8" || rawPixelFormat === "ya8")) {
              vfFilters.push(`format=${rawPixelFormat}`);
            }

            if (forceKeyFrames !== undefined && videoCodec !== "copy") {
              if (features.videoTranscode === false) throw new Error("Video transcoding is disabled by consumer feature configuration");
              if (outPlugin?.id !== "mp4" && outPlugin?.id !== "mov") throw new Error("Forced keyframes require MP4 or MOV output");
            }

            if (maxBFrames !== undefined && videoCodec !== "copy") {
              if (features.videoTranscode === false) throw new Error("Video transcoding is disabled by consumer feature configuration");
              if (maxBFrames > 0 && outPlugin?.id !== "mp4" && outPlugin?.id !== "mov") throw new Error("B-frame encoding requires MP4 or MOV output");
            }

            if ((zeroLatency || crf !== undefined) && videoCodec !== "copy" && features.videoTranscode === false) throw new Error("Video transcoding is disabled by consumer feature configuration");
            if (videoPreset !== undefined && videoCodec !== "copy") {
              if (!h264Presets.some(name => name === videoPreset)) throw new Error(`invalid preset '${videoPreset}'`);
              if (features.videoTranscode === false) throw new Error("Video transcoding is disabled by consumer feature configuration");
            }

            if ((videoQp !== undefined || videoBitrate) && videoCodec !== "copy" && features.videoTranscode === false) {
              throw new Error("Video transcoding is disabled by consumer feature configuration");
            }
            // Output frame counts refer to displayed pictures, never encoded packets.
            if (videoCodec !== "copy") {
              workingDoc = {
                ...workingDoc,
                tracks: await mapWork(workingDoc.tracks, async (track, index) => {
                  if (track.type !== "video" || (!zeroLatency && !imageOutput && videoPreset === undefined && crf === undefined && maxBFrames === undefined && forceKeyFrames === undefined && maxVideoFrames === undefined && videoQp === undefined && !videoBitrate && !track.decodedVideoFrames)) return track;
                  const limit = vfFilters.length === 0 && outputFps === undefined ? streamFrameLimits[index] : undefined;
                  const frames = await ensureDecodedFrames(track, workingDoc.timescale, budget, context.signal, limit);
                  return { ...track, samples: [], decodedVideoFrames: frames };
                }, context.signal)
              };
            }

            // Apply video filters (`-vf`)
            if (vfFilters.length > 0) {
              if (features.videoTranscode === false || features.filterGraph === false) {
                throw new Error("Video transcoding / filtergraph is disabled by consumer feature configuration");
              }
              const combinedChain = vfFilters.join(",");
              workingDoc = {
                ...workingDoc,
                tracks: await mapWork(workingDoc.tracks, async (t) => {


                  if (t.type !== "video") return t;
                  let presentationOffset = 0;
                  for (const edit of t.editList ?? []) {
                    if (edit.mediaTime < 0) presentationOffset -= edit.segmentDuration / workingDoc.timescale;
                    else { presentationOffset += edit.mediaTime / t.timescale; break; }
                  }
                  const offsetTicks = Math.round(presentationOffset * t.timescale);
                  const decoded = await ensureDecodedFrames(t, workingDoc.timescale, budget, context.signal);
                  // Filters use the displayed timeline; retain media coordinates for the existing edit list.
                  const displayed = decoded.map(frame => ({ ...frame, ptsSeconds: (Math.round(frame.ptsSeconds * t.timescale) - offsetTicks) / t.timescale }));
                  const diagnostics = {
                    timescale: workingDoc.containerFormat === "image2" && decoded[0]?.durationSeconds
                      ? 1 / decoded[0].durationSeconds : t.timescale,
                    sarWidth: t.codecDescriptions[0]?.sarWidth || 1,
                    sarHeight: t.codecDescriptions[0]?.sarHeight || 1,
                    sar: (t.codecDescriptions[0]?.sarWidth || 1) / (t.codecDescriptions[0]?.sarHeight || 1),
                    pixelFormat: t.codecDescriptions[0]?.pixFmt,
                    logLevel,
                    write: (text: string) => writeBytes(context.stderr, encodeUtf8(text), context.signal)
                  };
                  const inputFrames = feedback
                    ? await applyFeedback(displayed, feedback.rectangle, tiles => applyVideoFilterChain(
                      tiles, feedback.filter, budget, { ...diagnostics }, filename => readInput(resolvePath(context.cwd, filename)), registry, context.signal
                    ), budget, context.signal)
                    : displayed;
                  const filtered = await applyVideoFilterChain(inputFrames, combinedChain, budget, diagnostics, filename => readInput(resolvePath(context.cwd, filename)), registry, context.signal);
                  const first = filtered[0];
                  return {
                    ...t,
                    width: first?.width ?? t.width,
                    height: first?.height ?? t.height,
                    codecDescriptions: t.codecDescriptions.map(codec => ({ ...codec, pixFmt: diagnostics.pixelFormat, sarWidth: diagnostics.sarWidth, sarHeight: diagnostics.sarHeight })),
                    samples: [],
                    decodedVideoFrames: filtered.map(frame => ({ ...frame, ptsSeconds: (Math.round(frame.ptsSeconds * t.timescale) + offsetTicks) / t.timescale }))
                  };
                }, context.signal)
              };
            }

            if (maxSubtitleFrames !== undefined) {
              workingDoc = {
                ...workingDoc,
                tracks: workingDoc.tracks.map((track, index) => track.type === "subtitle"
                  ? { ...track, samples: track.samples.slice(0, streamFrameLimits[index]) } : track)
              };
            }
            // Apply `-frames:v <N>` limit
            if (maxVideoFrames !== undefined && !outputTarget.includes("%")) {
              workingDoc = {
                ...workingDoc,
                tracks: workingDoc.tracks.map((t, index) => {
                  if (t.type !== "video") return t;
                  const maxVideoFrames = streamFrameLimits[index];
                  if (maxVideoFrames === undefined) return t;
                  if (t.decodedVideoFrames && t.decodedVideoFrames.length > maxVideoFrames!) {
                    return {
                      ...t,
                      samples: [],
                      decodedVideoFrames: t.decodedVideoFrames.slice(0, maxVideoFrames)
                    };
                  }
                  if (t.samples.length > maxVideoFrames!) {
                    const slicedSamples = t.samples.slice(0, maxVideoFrames);
                    const dur = slicedSamples.reduce((acc, s) => acc + s.duration, 0);
                    return {
                      ...t,
                      duration: dur,
                      samples: slicedSamples
                    };
                  }
                  return t;
                })
              };
            }

            const segmentPlugin = outputFormat === "segment"
              ? segmentFormat === undefined ? registry.findByFilename(outputTarget)
                : (registry.findById(segmentFormat) ?? registry.findByFormatName(segmentFormat))
              : undefined;
            const audioSegment = segmentPlugin?.id === "wav" ||
              segmentPlugin?.supportedAudioCodecs.includes(`pcm_${segmentPlugin.id}`);
            // Keep decoded PCM frame timing separate from encoded packet payloads.
            let segmentAudioPackets: { pts: number; isKeyframe: boolean }[] | undefined;
            // Apply -ar (audioRate), -ac (audioChannels), and -af audio filters when transcoding audio
            if (audioSinks.length) {
              const audioCount = workingDoc.tracks.filter(track => track.type === "audio").length;
              afFilters.push(...audioSinks.map((sink, index) => ({ ordinal: audioCount + index, expression: sink.expression })));
              workingDoc = { ...workingDoc, tracks: [...workingDoc.tracks, ...audioSinks.map(sink => sink.track)] };
            }
            // A graph branch runs the same filters without final output conversion or cuts.
            async function filterAudio(t: MediaTrack, expression?: string, index?: number): Promise<MediaTrack> {
                  let work = 0;
                  const maxAudioFrames = index === undefined ? undefined : streamFrameLimits[index];
                  if (t.type !== "audio") return t;
                  const ordinal = index === undefined ? undefined : audioOrdinal++;
                  const sink = index !== undefined && index >= workingDoc.tracks.length - audioSinks.length;
                  let audioChannels = index === undefined ? undefined : audioChannelsForStream(audioChannelOptions, index, ordinal!);
                  if (audioChannels !== undefined && audioChannels <= 0) audioChannels = undefined;
                  const filter = expression === undefined
                    ? afFilters.filter(filter => filter.ordinal === undefined || filter.ordinal === ordinal).at(-1)
                    : { expression };
                  if (audioRate === undefined && audioChannels === undefined && rematrixVolume === 1 && !filter && maxAudioFrames === undefined && audioCodec !== "adpcm_ima_wav" && audioCodec !== "adpcm_ms") return t;
                  const doc = index === undefined ? loadedDocs.find(doc => doc.tracks.includes(t)) ?? loadedDocs[0]! : workingDoc;
                  const audio = t.decodedAudio ?? (t.codecDescriptions[0]?.codecName === "aac"
                    ? decodeAacTrack(doc, t) : t.codecDescriptions[0]?.codecName === "mp3"
                      ? decodeMp3Track(t) : undefined);
                  if (!audio) throw new Error("Audio filtering requires decoded PCM audio");
                  let matrixMaxval = rematrixMaxval;
                  let remixVolume = rematrixVolume;
                  let mixLevel = centerMixLevel;
                  let surroundLevel = surroundMixLevel;
                  let lfeLevel = lfeMixLevel;
                  let origRate = audio.sampleRate;
                  // Frame timestamps stay in sample units; filters expose ticks in this time base.
                  let audioTimeBase: number | undefined;
                  let loudnormResampling = false;
                  let filteredChannelMask = audio.channelMask;
                  let filteredChannelNames: string[] | undefined;
                  const inputCodec = t.codecDescriptions[0]?.codecName;
                  let filteredSampleFormat = inputCodec === "pcm_u8" ? "u8" : inputCodec === "pcm_s16le" ? "s16" : ["pcm_s24le", "pcm_s32le"].includes(inputCodec ?? "") ? "s32"
                    : inputCodec === "pcm_f32le" ? "flt" : "dbl";
                  let panSampleFormat = inputCodec === "pcm_s16be" ? "s16" : filteredSampleFormat;
                  const volFactor = t.volume ?? 1.0;
                  let stretched: typeof audio.channelData = audio.channelData;
                  let replayGainAvailable = true;
                  let audioStartSample = 0;
                  const audioMetadata: { pts: number; tags: Map<string, string> }[] = [];
                  let audioTimestamps: { start: number; end: number; pts: number; pos?: number | undefined }[] | undefined;
                  if (!sink && ((index !== undefined && (audioSegment || frameChecksumOutput)) || (filter && parseFilterChain(filter.expression)
                    .some(item => item.trim().split("=", 1)[0]!.split("@", 1)[0] === "areverse")))) {
                    if (index !== undefined && audioSegment) segmentAudioPackets = [];
                    audioTimestamps = [];
                    const length = stretched[0]?.length ?? 0;
                    for (let start = 0, n = 0; start < length; n++) {
                      if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                      const packet = t.samples[n];
                      const count = packet ? Math.max(0, Math.round(packet.duration * origRate / t.timescale)
                        - (packet.skipSamples ?? 0) - (packet.discardPadding ?? 0)) : 1024;
                      if (count === 0) continue;
                      const end = Math.min(length, start + count);
                      budget.allocateMemory(32);
                      audioTimestamps.push({ start, end, pts: start, pos: packet?.offset });
                      start = end;
                    }
                  }
                  // astats normalizes integer PCM against its maximum positive value.
                  let statsScale = t.codecDescriptions[0]?.codecName === "pcm_s16le" ? 32768 / 32767
                    : t.codecDescriptions[0]?.codecName === "pcm_s32le" ? 2147483648 / 2147483647 : 1;
                  if (filter) {
                    let audioCommands: { sample: number; target: string; action: string; expression: string }[] = [];
                    const audioFilters = parseFilterChain(filter.expression);
                    for (const [filterIndex, item] of audioFilters.entries()) {
                      if (++work % 1024 === 0) { await yieldTurn(context.signal); context.signal?.throwIfAborted(); }

                      let trimmed = item.trim();
                      const equals = trimmed.indexOf("=");
                      const instance = trimmed.indexOf("@");
                      const filterTarget = equals < 0 ? trimmed : trimmed.slice(0, equals);
                      if (instance >= 0 && (equals < 0 || instance < equals)) {
                        trimmed = trimmed.slice(0, instance) + (equals < 0 ? "" : trimmed.slice(equals));
                      }
                      // These filters retain their input sample format. Other DSP filters
                      // negotiate floating-point audio before a subsequent pan mixer.
                      const filterName = trimmed.split("=", 1)[0]!;
                      if (!["anull", "acopy", "ametadata", "arealtime", "asendcmd", "asetrate",
                        "asetnsamples", "ashowinfo", "afade", "silencedetect", "astats", "volume",
                        "aloop", "aresample", "apad", "adelay", "atempo", "aformat", "pan",
                        "channelmap", "channelsplit", "asettb", "asetpts", "aselect", "atrim", "areverse", "earwax"
                      ].includes(filterName)) panSampleFormat = "flt";
                      if (["extrastereo", "stereotools", "stereowiden"].includes(filterName) &&
                        (stretched.length === 1 && (!filteredChannelMask || filteredChannelMask === 4) ||
                          stretched.length === 6 && (filteredChannelMask === 0x3f || filteredChannelMask === 0x60f))) {
                        // Floating-point stereo negotiation keeps front gain and omits LFE.
                        const expression = stretched.length === 1
                          ? `stereo|c0=${Math.SQRT1_2}*c0|c1=${Math.SQRT1_2}*c0`
                          : `stereo|c0=c0+${Math.SQRT1_2}*c2+${Math.SQRT1_2}*c4|c1=c1+${Math.SQRT1_2}*c2+${Math.SQRT1_2}*c5`;
                        const stereo = await panAudio(expression, stretched, filteredChannelMask, "flt", budget, context.signal);
                        stretched = stereo.channels;
                        filteredChannelMask = stereo.channelMask;
                        filteredChannelNames = undefined;
                      }
                      if (filterName === "adeclick" || filterName === "adeclip") {
                        stretched = await declickAudio(stretched, origRate, trimmed, budget, context.signal);
                        continue;
                      }
                      if (filterName === "surround") {
                        if (filteredChannelMask && filteredChannelMask !== 3) throw new Error("surround: stereo input required");
                        stretched = await surroundAudio(stretched, origRate, trimmed, budget, context.signal);
                        filteredChannelMask = 0x3f;
                        filteredChannelNames = undefined;
                        continue;
                      }
                      if (filterName === "afwtdn") {
                        stretched = await denoiseWavelets(stretched, origRate, trimmed, budget, context.signal);
                        continue;
                      }
                      if (trimmed === "deesser" || trimmed.startsWith("deesser=")) {
                        stretched = await deessAudio(stretched, origRate, trimmed, budget, context.signal);
                        continue;
                      }
                      if (trimmed === "anull" || trimmed === "acopy") continue;
                      if (trimmed === "aphasemeter" || trimmed.startsWith("aphasemeter=")) {
                        let video = true;
                        for (const option of trimmed.slice("aphasemeter=".length).split(":").filter(Boolean)) {
                          const [key, value, extra] = option.split("=");
                          if (key !== "video" || extra !== undefined || !["0", "false", "no", "off"].includes(value ?? "")) {
                            throw new Error(`aphasemeter: unsupported option ${option}`);
                          }
                          video = false;
                        }
                        if (video) throw new Error("aphasemeter: only video=0 is supported");
                        if (stretched.length !== 2) throw new Error("aphasemeter: stereo audio required");
                        const length = stretched[0]!.length;
                        for (let start = 0, n = 0; start < length; n++) {
                          const timestamp = audioTimestamps?.[n];
                          const packet = t.samples[n];
                          const count = timestamp ? timestamp.end - timestamp.start
                            : packet ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024;
                          const end = Math.min(length, start + count);
                          let sum = 0;
                          for (let i = start; i < end; i++) {
                            if (++work % 4096 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                            const left = Math.fround(stretched[0]![i]!);
                            const right = Math.fround(stretched[1]![i]!);
                            const power = Math.fround(Math.fround(left * left) + Math.fround(right * right));
                            const phase = power === 0 ? 1 : Math.fround(Math.fround(2 * left * right) / power);
                            sum = Math.fround(sum + phase);
                          }
                          budget.allocateMemory(64);
                          const frame = audioMetadata[n] ?? { pts: timestamp?.pts ?? audioStartSample + start, tags: new Map<string, string>() };
                          frame.tags.set("lavfi.aphasemeter.phase", Math.fround(sum / (end - start)).toFixed(6));
                          audioMetadata[n] = frame;
                          start = end;
                        }
                        continue;
                      }
                      if (trimmed === "ametadata" || trimmed.startsWith("ametadata=")) {
                        let mode = "select";
                        let key: string | undefined;
                        let metadataValue: string | undefined;
                        let file: string | undefined;
                        for (const option of trimmed.slice("ametadata=".length).split(":").filter(Boolean)) {
                          const separator = option.indexOf("=");
                          const name = option.slice(0, separator);
                          const value = option.slice(separator + 1);
                          if (separator < 0) throw new Error(`ametadata: unsupported option ${option}`);
                          if (name === "mode") mode = value;
                          else if (name === "key") key = value;
                          else if (name === "value") metadataValue = value;
                          else if (name === "file") file = value;
                          else throw new Error(`ametadata: unsupported option ${name}`);
                        }
                        if (mode !== "print" && mode !== "add") throw new Error("ametadata: only mode=add and mode=print are supported");
                        if (mode === "add") {
                          if (!key || metadataValue === undefined) throw new Error("ametadata: mode=add requires key and value");
                          const length = stretched[0]?.length ?? 0;
                          for (let start = 0, n = 0; start < length; n++) {
                            if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                            const timestamp = audioTimestamps?.[n];
                            const packet = t.samples[n];
                            const count = timestamp ? timestamp.end - timestamp.start
                              : packet ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024;
                            const frame = audioMetadata[n] ?? { pts: timestamp?.pts ?? audioStartSample + start, tags: new Map<string, string>() };
                            if (!frame.tags.has(key)) {
                              budget.allocateMemory(64 + 2 * (key.length + metadataValue.length));
                              frame.tags.set(key, metadataValue);
                            }
                            audioMetadata[n] = frame;
                            start += count;
                          }
                          continue;
                        }
                        let report = "";
                        for (const [n, frame] of audioMetadata.entries()) {
                          if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                          let tags = "";
                          for (const [name, value] of frame.tags) {
                            if (key !== undefined && key !== name) continue;
                            if (metadataValue !== undefined && metadataValue !== value) continue;
                            const line = `${name}=${value}\n`;
                            budget.allocateMemory(line.length * 2);
                            tags += line;
                          }
                          if (!tags) continue;
                          const header = `frame:${String(n).padEnd(5)}pts:${String(frame.pts).padEnd(7)} pts_time:${Number((frame.pts / origRate).toPrecision(6))}\n`;
                          budget.allocateMemory(header.length * 2);
                          report += header + tags;
                        }
                        if (file === "-") await writeBytes(context.stdout, encodeUtf8(report), context.signal);
                        else if (file) await writeFileOutput(context, encodeUtf8(report), data => context.fs.writeFile(resolvePath(context.cwd, file!), data, { signal: context.signal }));
                        else if (logLevel >= 32) await writeBytes(context.stderr, encodeUtf8(report), context.signal);
                        continue;
                      }
                      if (trimmed === "arealtime" || trimmed.startsWith("arealtime=")) {
                        let speed = 1;
                        let limit = 2;
                        const argument = trimmed.slice("arealtime=".length);
                        const options = argument ? argument.split(":") : [];
                        if (argument.endsWith(":")) options.pop();
                        for (const [index, option] of options.entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? ["limit", "speed"][index] : option.slice(0, separator);
                          const value = separator < 0 ? option : option.slice(separator + 1);
                          if (key === "speed") {
                            speed = Number(value);
                            if (!value || !Number.isFinite(speed) || speed < 2.2250738585072014e-308) throw new Error("arealtime: invalid speed");
                          } else if (key === "limit") {
                            limit = parseHlsDuration(value);
                            if (!Number.isFinite(limit)) throw new Error("arealtime: invalid limit");
                          } else throw new Error(`arealtime: unsupported option ${key}`);
                        }
                        let origin: number | undefined;
                        const length = stretched[0]?.length ?? 0;
                        for (let start = 0, n = 0; start < length; n++) {
                          if (n % 1024 === 0) await yieldTurn(context.signal);
                          budget.checkCpu();
                          context.signal?.throwIfAborted();
                          const packet = t.samples[n];
                          const timestamp = audioTimestamps?.[n];
                          const count = timestamp ? timestamp.end - timestamp.start
                            : packet ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024;
                          const pts = (timestamp?.pts ?? audioStartSample + start) / origRate * 1000 / speed;
                          const now = Date.now();
                          origin ??= now - pts;
                          const delay = pts + origin - now;
                          if (!Number.isFinite(delay) || Math.abs(delay) > limit * 1000 / speed) {
                            origin = now - pts;
                          } else if (delay > 0) {
                            // Bound each timer so long waits remain cancellable and budgeted.
                            const deadline = now + delay;
                            while (Date.now() < deadline) {
                              await new Promise<void>((resolve, reject) => {
                                const signal = context.signal;
                                const abort = () => {
                                  clearTimeout(timer);
                                  signal?.removeEventListener("abort", abort);
                                  reject(signal?.reason);
                                };
                                const timer = setTimeout(() => {
                                  signal?.removeEventListener("abort", abort);
                                  resolve();
                                }, Math.min(1000, deadline - Date.now()));
                                signal?.addEventListener("abort", abort, { once: true });
                                if (signal?.aborted) abort();
                              });
                              context.signal?.throwIfAborted();
                              budget.checkCpu();
                            }
                          }
                          start += count;
                        }
                        continue;
                      }
                      if (trimmed.startsWith("asendcmd=")) {
                        let commands = trimmed.slice("asendcmd=".length);
                        if (commands.startsWith("c=")) commands = commands.slice(2);
                        else if (commands.startsWith("commands=")) commands = commands.slice(9);
                        const scheduled = commands.split(";").filter(command => command.trim()).map(command => {
                          const words = Array.from(command, char => char.trim() ? char : " ").join("").split(" ").filter(Boolean);
                          const time = Number(words.shift());
                          if (words[0] === "[enter]") words.shift();
                          const [target, action, expression] = words;
                          const supported = action === "volume" && (target === "volume" || target?.startsWith("volume@"))
                            || action === "m" && (target === "extrastereo" || target?.startsWith("extrastereo@"))
                            || action === "level_out" && (target === "crossfeed" || target?.startsWith("crossfeed@"))
                            || action === "feedback" && (target === "stereowiden" || target?.startsWith("stereowiden@"))
                            || action === "dry" && (target === "compensationdelay" || target?.startsWith("compensationdelay@"))
                            || action === "limit" && (target === "alimiter" || target?.startsWith("alimiter@"))
                            || ["unity", "silence", "curve", "c", "nb_samples", "ns", "type", "t"].includes(action!) && (target === "afade" || target?.startsWith("afade@"))
                            || action === "original" && (target === "dialoguenhance" || target?.startsWith("dialoguenhance@"));
                          if (!Number.isFinite(time) || time < 0 || words.length !== 3 || !target || !supported || !expression) {
                            throw new Error("asendcmd: expected TIME stereowiden[@NAME] feedback GAIN or TIME crossfeed[@NAME] level_out GAIN or TIME extrastereo[@NAME] m WIDTH or TIME volume[@NAME] volume GAIN or TIME compensationdelay[@NAME] dry GAIN or TIME alimiter[@NAME] limit LIMIT or TIME afade[@NAME] unity|silence|curve|c|nb_samples|ns|type|t VALUE or TIME dialoguenhance[@NAME] original GAIN");
                          }
                          return { time, target, action: action!, expression };
                        });
                        if (!scheduled.length) throw new Error("asendcmd: commands are required");
                        budget.allocateMemory(scheduled.length * 64);
                        scheduled.sort((a, b) => a.time - b.time);
                        let next = 0;
                        const length = stretched[0]?.length ?? 0;
                        for (let start = 0, n = 0; start < length && next < scheduled.length; n++) {
                          budget.checkCpu();
                          if (++work % 1024 === 0) { await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                          const packet = t.samples[n];
                          const timestamp = audioTimestamps?.[n];
                          const count = timestamp ? timestamp.end - timestamp.start
                            : packet ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024;
                          const pts = timestamp?.pts ?? (packet ? packet.pts * origRate / t.timescale : audioStartSample + start);
                          while (next < scheduled.length && scheduled[next]!.time <= pts / origRate) {
                            const command = scheduled[next++]!;
                            audioCommands.push({ sample: start, target: command.target, action: command.action, expression: command.expression });
                          }
                          start += count;
                        }
                      } else if (trimmed === "asetrate" || trimmed.startsWith("asetrate=")) {
                        let rate = 44100;
                        const argument = trimmed === "asetrate" ? "" : trimmed.slice("asetrate=".length);
                        for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? (index === 0 ? "sample_rate" : undefined) : option.slice(0, separator);
                          const value = separator < 0 ? option : option.slice(separator + 1);
                          if (key !== "sample_rate" && key !== "r") throw new Error(`asetrate: unsupported option ${key}`);
                          rate = roundToEven(parseFilterExpression(value, "asetrate", {}));
                          if (rate < 1 || rate > 2147483647) throw new Error("asetrate: invalid sample rate");
                        }
                        budget.checkDuration((stretched[0]?.length ?? 0) / rate);
                        // Capture incoming frames before changing the rate used to interpret packets.
                        if (!audioTimestamps) {
                          audioTimestamps = [];
                          const length = stretched[0]?.length ?? 0;
                          for (let start = 0, n = 0; start < length; n++) {
                            if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                            const packet = t.samples[n];
                            const count = packet ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024;
                            const end = Math.min(length, start + count);
                            budget.allocateMemory(32);
                            audioTimestamps.push({ start, end, pos: packet?.offset,
                              pts: packet ? packet.pts * origRate / t.timescale : audioStartSample + start });
                            start = end;
                          }
                        }
                        // Reinterpret the same PCM at the new rate, including subsequent filters.
                        origRate = rate;
                      } else if (trimmed === "asetnsamples" || trimmed.startsWith("asetnsamples=")) {
                        const { size, pad } = parseAsetnsamples(trimmed === "asetnsamples" ? "" : trimmed.slice("asetnsamples=".length));
                        const length = stretched[0]?.length ?? 0;
                        const padded = pad ? Math.ceil(length / size) * size : length;
                        budget.checkSamples(padded);
                        budget.checkDuration(padded / origRate);
                        budget.allocateMemory(Math.ceil(padded / size) * 24);
                        if (padded !== length) {
                          stretched = stretched.map(channel => {
                            budget.allocateMemory(padded * channel.BYTES_PER_ELEMENT);
                            const output = channel instanceof Float64Array ? new Float64Array(padded) : new Float32Array(padded);
                            output.set(channel);
                            return output;
                          });
                        }
                        const previous = audioTimestamps;
                        audioTimestamps = [];
                        let frameIndex = 0;
                        let packetEnd = t.samples[0] ? Math.round(t.samples[0].duration * origRate / t.timescale) : 0;
                        for (let start = 0; start < padded; start += size) {
                          if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                          while (previous && frameIndex + 1 < previous.length && previous[frameIndex]!.end <= start) frameIndex++;
                          while (!previous && frameIndex + 1 < t.samples.length && packetEnd <= start) {
                            frameIndex++;
                            packetEnd += Math.round(t.samples[frameIndex]!.duration * origRate / t.timescale);
                          }
                          const frame = previous?.[frameIndex];
                          audioTimestamps.push({ start, end: Math.min(padded, start + size),
                            pos: previous ? frame?.pos : t.samples[frameIndex]?.offset,
                            pts: frame ? frame.pts + start - frame.start : audioStartSample + start });
                        }
                      } else if (trimmed === "ashowinfo") {
                        if (logLevel < 32) continue;
                        const format = filteredSampleFormat;
                        const planar = format === "s16p" || format === "fltp" || format === "dblp";
                        const bytesPerSample = format === "u8" ? 1 : format === "s16" || format === "s16p" ? 2 : format === "dbl" || format === "dblp" ? 8 : 4;
                        const sample = new DataView(new ArrayBuffer(bytesPerSample));
                        const length = stretched[0]?.length ?? 0;
                        const channels = stretched.length;
                        const layout = channels === 1 ? "mono" : channels === 2 ? "stereo"
                          : channels === 3 && filteredChannelMask === 7 ? "3.0" : `${channels} channels`;
                        for (let start = 0, n = 0; start < length; n++) {
                          budget.checkCpu();
                          await yieldTurn(context.signal);
                          context.signal?.throwIfAborted();
                          const packet = t.samples[n];
                          const timestamp = audioTimestamps?.[n];
                          const count = timestamp ? timestamp.end - timestamp.start
                            : packet ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024;
                          const end = Math.min(length, start + count);
                          const timeBase = audioTimeBase ?? 1 / origRate;
                          const samplePts = timestamp?.pts ?? audioStartSample + start;
                          const pts = Math.sign(samplePts) * Math.round(Math.abs(samplePts) / (timeBase * origRate));
                          let a = 0, b = 0;
                          const planeChecksums: string[] = [];
                          for (let plane = 0; plane < (planar ? channels : 1); plane++) {
                            let pa = 0, pb = 0;
                            for (let i = start; i < end; i++) {
                              if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                              for (let c = planar ? plane : 0; c < (planar ? plane + 1 : channels); c++) {
                                const value = stretched[c]![i]!;
                                if (format === "u8") sample.setUint8(0, Math.max(0, Math.min(255, Math.round(value * 128) + 128)));
                                else if (format === "s16" || format === "s16p") sample.setInt16(0, Math.max(-32768, Math.min(32767, Math.round(value * 32768))), true);
                                else if (format === "s32") sample.setInt32(0, Math.max(-2147483648, Math.min(2147483647, Math.round(value * 2147483648))), true);
                                else if (format === "flt" || format === "fltp") sample.setFloat32(0, value, true);
                                else sample.setFloat64(0, value, true);
                                for (let byte = 0; byte < bytesPerSample; byte++) {
                                  const value = sample.getUint8(byte);
                                  a = (a + value) % 65521;
                                  b = (b + a) % 65521;
                                  pa = (pa + value) % 65521;
                                  pb = (pb + pa) % 65521;
                                }
                              }
                            }
                            planeChecksums.push(((pb * 65536 + pa) >>> 0).toString(16).padStart(8, "0").toUpperCase());
                          }
                          const checksum = ((b * 65536 + a) >>> 0).toString(16).padStart(8, "0").toUpperCase();
                          await writeBytes(context.stderr, encodeUtf8(`[ashowinfo] n:${n} pts:${Number.isNaN(pts) ? "NOPTS" : pts} pts_time:${Number.isNaN(pts) ? "NOPTS" : Number((pts * timeBase).toPrecision(6))} pos:-1 fmt:${format} channels:${channels} chlayout:${layout} rate:${origRate} nb_samples:${end - start} checksum:${checksum} plane_checksums: [ ${planeChecksums.join(" ")} ]\n`), context.signal);
                          start = end;
                        }
                      } else if (trimmed === "asubcut" || trimmed.startsWith("asubcut=")) {
                        stretched = await cutSubAudio(stretched, origRate, trimmed, t.codecDescriptions[0]?.codecName, budget, context.signal);
                      } else if (trimmed === "asubboost" || trimmed.startsWith("asubboost=")) {
                        stretched = await boostSubAudio(stretched, origRate, trimmed, budget, context.signal);
                      } else if (trimmed === "highpass" || trimmed.startsWith("highpass=")) {
                        stretched = await highpassAudio(stretched, origRate, trimmed, budget, context.signal);
                      } else if (trimmed === "asupercut" || trimmed.startsWith("asupercut=")) {
                        stretched = await cutUltrasonicAudio(stretched, origRate, trimmed, budget, context.signal);
                      } else if (trimmed === "aexciter" || trimmed.startsWith("aexciter=")) {
                        stretched = await exciteAudio(stretched, origRate, trimmed, budget, context.signal);
                      } else if (trimmed === "adecorrelate" || trimmed.startsWith("adecorrelate=")) {
                        stretched = await decorrelateAudio(stretched, origRate, trimmed, budget, context.signal);
                      } else if (filterName === "flanger") {
                        stretched = await flangeAudio(stretched, origRate, trimmed, budget, context.signal);
                        filteredSampleFormat = "dblp";
                      } else if (filterName === "aecho" || filterName === "chorus") {
                        const inputLength = stretched[0]?.length ?? 0;
                        if (filterName === "chorus") {
                          stretched = await chorusAudio(stretched, origRate, trimmed, budget, context.signal);
                          filteredSampleFormat = "fltp";
                          statsScale = 1;
                        } else {
                          // Echo shares its input/output format; a downstream volume can
                          // require floating point before the echo runs.
                          const next = audioFilters[filterIndex + 1]?.trim();
                          if (next?.split("=", 1)[0]!.split("@", 1)[0] === "volume") {
                            let precision = "float";
                            const argument = next.includes("=") ? next.slice(next.indexOf("=") + 1) : "";
                            for (const [index, option] of argument.split(":").entries()) {
                              const separator = option.indexOf("=");
                              const key = separator < 0 ? ["volume", "precision"][index] : option.slice(0, separator).trim();
                              if (key === "precision") precision = (separator < 0 ? option : option.slice(separator + 1)).trim();
                            }
                            if (precision === "float" || precision === "1") filteredSampleFormat = "flt";
                            else if (precision === "double" || precision === "2") filteredSampleFormat = "dbl";
                          }
                          if (filteredSampleFormat === "u8") filteredSampleFormat = "s16";
                          stretched = await echoAudio(stretched, origRate, trimmed, filteredSampleFormat, budget, context.signal);
                          if (["flt", "fltp", "dbl", "dblp"].includes(filteredSampleFormat)) statsScale = 1;
                        }
                        if (!audioTimestamps) {
                          audioTimestamps = [];
                          for (let start = 0, n = 0; start < inputLength; n++) {
                            if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                            const packet = t.samples[n];
                            const count = packet ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024;
                            const end = Math.min(inputLength, start + count);
                            budget.allocateMemory(24);
                            audioTimestamps.push({ start, end, pts: audioStartSample + start });
                            start = end;
                          }
                        }
                        const last = audioTimestamps.at(-1);
                        const tailPts = last ? last.pts + last.end - last.start : audioStartSample;
                        for (let start = inputLength; start < stretched[0]!.length; start += 2048) {
                          if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                          budget.allocateMemory(24);
                          audioTimestamps.push({ start, end: Math.min(stretched[0]!.length, start + 2048),
                            pts: tailPts + start - inputLength });
                        }
                      } else if (trimmed === "aphaser" || trimmed.startsWith("aphaser=")) {
                        if (filteredSampleFormat === "u8") filteredSampleFormat = "s16";
                        stretched = await phaseAudio(stretched, origRate, trimmed, filteredSampleFormat, budget, context.signal);
                      } else if (filterName === "aphaseshift" || filterName === "afreqshift") {
                        filteredSampleFormat = filteredSampleFormat === "dbl" || filteredSampleFormat === "dblp" ? "dblp" : "fltp";
                        stretched = await shiftAudioPhase(stretched, origRate, trimmed, filteredSampleFormat, budget, context.signal);
                        statsScale = 1;
                      } else if (trimmed === "apulsator" || trimmed.startsWith("apulsator=")) {
                        stretched = await pulsateAudio(stretched, origRate, trimmed, budget, context.signal);
                        filteredChannelMask = 3;
                        filteredChannelNames = undefined;
                        filteredSampleFormat = "dbl";
                        statsScale = 1;
                      } else if (trimmed === "adynamicequalizer" || trimmed.startsWith("adynamicequalizer=")) {
                        stretched = await listenDynamicEqualizer(stretched, origRate, trimmed, budget, context.signal);
                        statsScale = 1;
                      } else if (trimmed === "atilt" || trimmed.startsWith("atilt=")) {
                        stretched = await tiltAudio(stretched, origRate, trimmed, budget, context.signal);
                        statsScale = 1;
                      } else if (trimmed === "asoftclip" || trimmed.startsWith("asoftclip=")) {
                        stretched = await softClipAudio(stretched, trimmed, budget, context.signal);
                        statsScale = 1;
                      } else if (trimmed === "apsyclip" || trimmed.startsWith("apsyclip=")) {
                        stretched = await psychoacousticClip(stretched, origRate, trimmed, budget, context.signal);
                        statsScale = 1;
                      } else if (filterName === "silenceremove" || filterName === "alimiter" || filterName === "speechnorm" || filterName === "afade" || filterName === "compensationdelay" || filterName === "vibrato" || filterName === "tremolo") {
                        if (!audioTimestamps) {
                          audioTimestamps = [];
                          const length = stretched[0]?.length ?? 0;
                          for (let start = 0, n = 0; start < length; n++) {
                            if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                            const packet = t.samples[n];
                            const count = packet ? Math.max(0, Math.round(packet.duration * origRate / t.timescale)
                              - (packet.skipSamples ?? 0) - (packet.discardPadding ?? 0)) : 1024;
                            if (count === 0) continue;
                            const end = Math.min(length, start + count);
                            const pts = packet ? packet.pts * origRate / t.timescale + (packet.skipSamples ?? 0) : audioStartSample + start;
                            budget.allocateMemory(32);
                            audioTimestamps.push({ start, end, pts, pos: packet?.offset });
                            start = end;
                          }
                        }
                        if (filterName === "silenceremove") {
                          const removed = await removeSilence(stretched, origRate, trimmed, audioTimestamps, budget, context.signal);
                          stretched = removed.channels;
                          audioTimestamps = removed.frames;
                        } else if (filterName === "tremolo") {
                          stretched = await tremoloAudio(stretched, origRate, trimmed, audioTimestamps, budget, context.signal);
                        } else if (filterName === "vibrato") {
                          filteredSampleFormat = "dblp";
                          stretched = await vibratoAudio(stretched, origRate, trimmed, audioTimestamps, budget, context.signal);
                        } else if (filterName === "compensationdelay") {
                          filteredSampleFormat = "dblp";
                          const commands = audioCommands.filter(command => command.target === "compensationdelay" || command.target === filterTarget)
                            .sort((a, b) => a.sample - b.sample);
                          stretched = await compensateAudioDelay(stretched, origRate, trimmed, audioTimestamps, commands, budget, context.signal);
                        } else if (filterName === "afade") {
                          const commands = audioCommands.filter(command => command.target === "afade" || command.target === filterTarget)
                            .sort((a, b) => a.sample - b.sample);
                          audioCommands = audioCommands.filter(command => command.target !== "afade" && command.target !== filterTarget);
                          stretched = await fadeAudio(stretched, origRate, trimmed, audioTimestamps, audioStartSample, commands, budget, context.signal, panSampleFormat === "s16" ? "s16" : filteredSampleFormat);
                        } else if (filterName === "alimiter") {
                          filteredSampleFormat = "dbl";
                          const commands = audioCommands.filter(command => command.target === "alimiter" || command.target === filterTarget)
                            .sort((a, b) => a.sample - b.sample);
                          // Native asendcmd sends each command to the first matching instance.
                          audioCommands = audioCommands.filter(command => command.target !== "alimiter" && command.target !== filterTarget);
                          const limited = await limitAudio(stretched, origRate, trimmed, budget, context.signal, audioTimestamps, commands);
                          stretched = limited.channels;
                          audioTimestamps = limited.frames;
                        } else {
                          filteredSampleFormat = filteredSampleFormat === "dbl" || filteredSampleFormat === "dblp" ? "dblp" : "fltp";
                          stretched = await normalizeSpeech(stretched, origRate, audioTimestamps, trimmed, filteredSampleFormat, budget, context.signal);
                        }
                        statsScale = 1;
                      } else if (trimmed === "agate" || trimmed.startsWith("agate=")) {
                        stretched = await applyAudioGate(stretched, origRate, trimmed, budget, context.signal);
                        statsScale = 1;
                      } else if (trimmed === "acompressor" || trimmed.startsWith("acompressor=")) {
                        stretched = await compressAudio(stretched, origRate, trimmed, budget, context.signal);
                        statsScale = 1;
                      } else if (trimmed === "mcompand" || trimmed.startsWith("mcompand=")) {
                        stretched = await multibandCompandAudio(stretched, origRate, trimmed, budget, context.signal);
                      } else if (trimmed === "compand" || trimmed.startsWith("compand=")) {
                        filteredSampleFormat = "dblp";
                        stretched = await compandAudio(stretched, origRate, trimmed, budget, context.signal, async message => {
                          if (logLevel >= 24) await writeBytes(context.stderr, encodeUtf8(message), context.signal);
                        });
                      } else if (trimmed === "dynaudnorm" || trimmed.startsWith("dynaudnorm=")) {
                        filteredSampleFormat = "dblp";
                        const normalized = await normalizeAudio(stretched, origRate, trimmed, budget, context.signal, async message => {
                          if (logLevel >= 24) await writeBytes(context.stderr, encodeUtf8(message), context.signal);
                        });
                        stretched = normalized.channels;
                        const length = stretched[0]?.length ?? 0;
                        budget.allocateMemory(Math.ceil(length / normalized.frameSize) * 24);
                        const previous = audioTimestamps;
                        audioTimestamps = [];
                        let frameIndex = 0;
                        for (let start = 0; start < length; start += normalized.frameSize) {
                          if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                          while (previous && frameIndex + 1 < previous.length && previous[frameIndex]!.end <= start) frameIndex++;
                          const frame = previous?.[frameIndex];
                          audioTimestamps.push({ start, end: Math.min(length, start + normalized.frameSize),
                            pts: frame ? frame.pts + start - frame.start : audioStartSample + start });
                        }
                        statsScale = 1;
                      } else if (trimmed === "silencedetect" || trimmed.startsWith("silencedetect=")) {
                        let noise = 0.001;
                        let duration = 2;
                        let mono = false;
                        const argument = trimmed.slice("silencedetect=".length);
                        for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? ["noise", "duration", "mono"][index] : option.slice(0, separator);
                          const value = separator < 0 ? option : option.slice(separator + 1);
                          if (key === "noise" || key === "n") {
                            noise = parseFilterExpression(value, "silencedetect", {});
                            if (!value || !Number.isFinite(noise) || noise < 0) throw new Error("silencedetect: invalid noise");
                          } else if (key === "duration" || key === "d") {
                            duration = parseHlsDuration(value);
                            if (!value || !Number.isFinite(duration) || duration < 0 || duration > 86400) throw new Error("silencedetect: invalid duration");
                          } else if (key === "mono" || key === "m") {
                            if (!["0", "1", "true", "false", "yes", "no", "y", "n", "on", "off"].includes(value.toLowerCase())) throw new Error("silencedetect: invalid mono");
                            mono = ["1", "true", "yes", "y", "on"].includes(value.toLowerCase());
                          } else throw new Error(`silencedetect: unsupported option ${key}`);
                        }
                        // Native s16 detection truncates noise in signed PCM units.
                        if (panSampleFormat === "s16") noise = Math.trunc(noise * 32767) / 32768;
                        const channels = stretched.length;
                        const counts = new Array<number>(mono ? channels : 1).fill(0);
                        const starts = new Array<number | undefined>(counts.length).fill(undefined);
                        const minimum = Math.round(duration * origRate) * (mono ? 1 : channels);
                        const length = stretched[0]?.length ?? 0;
                        for (let frameStart = 0, n = 0; frameStart < length; n++) {
                          const timestamp = audioTimestamps?.[n];
                          const packet = t.samples[n];
                          const count = timestamp ? timestamp.end - timestamp.start
                            : packet ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024;
                          const frameEnd = Math.min(length, frameStart + count);
                          budget.allocateMemory(64);
                          const metadata = audioMetadata[n] ?? { pts: timestamp?.pts ?? audioStartSample + frameStart, tags: new Map<string, string>() };
                          audioMetadata[n] = metadata;
                          for (let frame = frameStart; frame < frameEnd; frame++) {
                            const pts = (timestamp?.pts ?? audioStartSample + frameStart) + frame - frameStart;
                            for (let channel = 0; channel < channels; channel++) {
                              if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                              const slot = mono ? channel : 0;
                              const prefix = mono ? `channel: ${channel} | ` : "";
                              const suffix = mono ? `.${channel + 1}` : "";
                              if (Math.abs(stretched[channel]![frame]!) < noise) {
                                counts[slot]!++;
                                if (starts[slot] === undefined && counts[slot]! >= minimum) {
                                  const start = pts / origRate - (minimum / (mono ? 1 : channels) - 1) / origRate;
                                  starts[slot] = start;
                                  budget.allocateMemory(128);
                                  metadata.tags.set(`lavfi.silence_start${suffix}`, String(Number(start.toPrecision(6))));
                                  if (logLevel >= 32) await writeBytes(context.stderr, encodeUtf8(`${prefix}silence_start: ${Number(start.toPrecision(6))}\n`), context.signal);
                                }
                              } else {
                                const start = starts[slot];
                                if (start !== undefined) {
                                  const end = pts / origRate;
                                  budget.allocateMemory(256);
                                  metadata.tags.set(`lavfi.silence_end${suffix}`, String(Number(end.toPrecision(6))));
                                  metadata.tags.set(`lavfi.silence_duration${suffix}`, String(Number((end - start).toPrecision(6))));
                                  if (logLevel >= 32) await writeBytes(context.stderr, encodeUtf8(`${prefix}silence_end: ${Number(end.toPrecision(6))} | silence_duration: ${Number((end - start).toPrecision(6))}\n`), context.signal);
                                }
                                counts[slot] = 0;
                                starts[slot] = undefined;
                              }
                            }
                          }
                          frameStart = frameEnd;
                        }
                        for (const [slot, start] of starts.entries()) {
                          if (start === undefined) continue;
                          const last = audioTimestamps?.at(-1);
                          const end = (last ? last.pts + last.end - last.start : audioStartSample + length) / origRate;
                          const prefix = mono ? `channel: ${slot} | ` : "";
                          if (logLevel >= 32) await writeBytes(context.stderr, encodeUtf8(`${prefix}silence_end: ${Number(end.toPrecision(6))} | silence_duration: ${Number((end - start).toPrecision(6))}\n`), context.signal);
                        }
                      } else if (trimmed === "astats" || trimmed.startsWith("astats=")) {
                        let perChannel: ReadonlySet<string> | undefined;
                        let overall: ReadonlySet<string> | undefined;
                        const supported = ["DC_offset", "Min_level", "Max_level", "Peak_level", "RMS_level", "Number_of_samples"];
                        let reset = 0;
                        let metadata = false;
                        let rmsLength = 0.05;
                        if (trimmed.startsWith("astats=")) {
                          for (const [index, option] of trimmed.slice("astats=".length).split(":").entries()) {
                            const parts = option.split("=");
                            const key = parts.length === 1 && index === 0 ? "length" : parts[0];
                            const value = parts.length === 1 ? parts[0]! : parts[1]!;
                            const extra = parts[2];
                            if ((key === "measure_perchannel" || key === "measure_overall") && value !== undefined && extra === undefined) {
                              const metrics = value === "none" ? [] : value.split("+");
                              if (metrics.some(metric => !supported.includes(metric))) {
                                throw new Error(`astats: unsupported option ${option}`);
                              }
                              if (key === "measure_perchannel") perChannel = new Set(metrics);
                              else overall = new Set(metrics);
                            } else if (key === "length" && extra === undefined) {
                              rmsLength = parseFilterExpression(value, "astats", {});
                              if (!Number.isFinite(rmsLength) || rmsLength < 0 || rmsLength > 10) {
                                throw new Error("astats: length must be between 0 and 10");
                              }
                            } else if (key === "reset" && extra === undefined) {
                              reset = Number(value);
                              if (!value?.trim() || !Number.isInteger(reset) || reset < 0 || reset > 2147483647) {
                                throw new Error("astats: invalid reset");
                              }
                            } else if (key === "metadata" && extra === undefined &&
                              ["0", "1", "false", "true", "no", "yes", "off", "on"].includes(value?.toLowerCase() ?? "")) {
                              metadata = ["1", "true", "yes", "on"].includes(value!.toLowerCase());
                            } else {
                              throw new Error(`astats: unsupported option ${option}`);
                            }
                          }
                        }
                        let report = "";
                        if (metadata) {
                          const length = stretched[0]?.length ?? 0;
                          let intervalStart = 0;
                          let frames: { end: number; tags: Map<string, string> }[] = [];
                          for (let start = 0, n = 0; start < length; n++) {
                            if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                            const timestamp = audioTimestamps?.[n];
                            const packet = t.samples[n];
                            const count = timestamp ? timestamp.end - timestamp.start
                              : packet ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024;
                            const end = Math.min(length, start + count);
                            budget.allocateMemory(96);
                            const frame = audioMetadata[n] ?? { pts: timestamp?.pts ?? audioStartSample + start, tags: new Map<string, string>() };
                            audioMetadata[n] = frame;
                            frames.push({ end: end - intervalStart, tags: frame.tags });
                            if (end === length || reset > 0 && (n + 1) % reset === 0) {
                              report = await measureAstats(stretched.map(channel => channel.subarray(intervalStart, end)),
                                origRate, statsScale, rmsLength, budget, context.signal, perChannel, overall, frames);
                              intervalStart = end;
                              frames = [];
                            }
                            start = end;
                          }
                        } else {
                          // Reset before the next frame, so an exact interval at EOF is retained.
                          let statsStart = 0;
                          if (reset > 0) {
                            const length = stretched[0]?.length ?? 0;
                            for (let start = 0, n = 0; start < length; n++) {
                              if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                              if (n % reset === 0) statsStart = start;
                              const timestamp = audioTimestamps?.[n];
                              const packet = t.samples[n];
                              const count = timestamp ? timestamp.end - timestamp.start
                                : packet ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024;
                              start += count;
                            }
                          }
                          report = await measureAstats(statsStart ? stretched.map(channel => channel.subarray(statsStart)) : stretched, origRate, statsScale, rmsLength, budget, context.signal, perChannel, overall);
                        }
                        await writeBytes(context.stderr, encodeUtf8(report), context.signal);
                      } else if (trimmed === "loudnorm" || trimmed.startsWith("loudnorm=")) {
                        const normalized = await normalizeLoudness(stretched, origRate,
                          trimmed === "loudnorm" ? "" : trimmed.slice("loudnorm=".length), budget, context.signal);
                        stretched = normalized.channels;
                        origRate = 192000;
                        loudnormResampling = true;
                        if (normalized.report && logLevel >= 32) await writeBytes(context.stderr, encodeUtf8(normalized.report), context.signal);
                      } else if (trimmed === "ebur128" || trimmed.startsWith("ebur128=")) {
                        let metadata = false;
                        const options: string[] = [];
                        for (const option of trimmed.slice("ebur128=".length).split(":").filter(Boolean)) {
                          if (option.startsWith("metadata=")) {
                            metadata = parseFilterBoolean(option.slice("metadata=".length), "ebur128: invalid metadata");
                          } else options.push(option);
                        }
                        if (metadata) {
                          const previous = audioTimestamps;
                          const previousMetadata = audioMetadata.splice(0);
                          audioTimestamps = [];
                          const length = stretched[0]?.length ?? 0;
                          const size = Math.max(1, Math.floor(origRate / 10));
                          let inputIndex = 0;
                          let inputStart = 0;
                          for (let start = 0; start < length; start += size) {
                            if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                            while (inputStart < start) {
                              if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                              const packet = t.samples[inputIndex];
                              const end = previous?.[inputIndex]?.end ?? inputStart + (packet
                                ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024);
                              if (end > start) break;
                              inputStart = end;
                              inputIndex++;
                            }
                            const frame = previous?.[inputIndex];
                            const pts = frame ? frame.pts + start - frame.start : audioStartSample + start;
                            const tags = new Map(previousMetadata[inputIndex]?.tags);
                            budget.allocateMemory(64 + tags.size * 64);
                            audioTimestamps.push({ start, end: Math.min(length, start + size), pts });
                            audioMetadata.push({ pts, tags });
                          }
                        }
                        for await (const report of measureEbur128(stretched, origRate, filteredChannelMask,
                          options.join(":"), budget, logLevel, context.signal,
                          audioTimestamps, audioStartSample, metadata ? audioMetadata : undefined)) {
                          await writeBytes(context.stderr, encodeUtf8(report), context.signal);
                        }
                      } else if (trimmed === "replaygain" || trimmed === "replaygain=") {
                        const report = await measureReplayGain(stretched, origRate, budget, context.signal);
                        if (logLevel >= 32) await writeBytes(context.stderr, encodeUtf8(report), context.signal);
                      } else if (trimmed === "volumedetect") {
                        let count = 0;
                        let sumSquares = 0;
                        let peak = 0;
                        const histogram = new Float64Array(92);
                        // FFmpeg measures signed 16-bit samples, including every channel.
                        for (const channel of stretched) {
                          for (const value of channel) {
                            if (++work % 1024 === 0) { await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                            const sample = Math.max(-32768, Math.min(32767, Math.round(value * 32768)));
                            count++;
                            sumSquares += sample * sample;
                            peak = Math.max(peak, Math.abs(sample));
                            const db = sample === 0 ? 91 : Math.floor(-10 * Math.log10(sample * sample / (32768 * 32768)));
                            histogram[db]!++;
                          }
                        }
                        let report = `n_samples: ${count}\n`;
                        if (count > 0) {
                          const meanSquare = Math.round(sumSquares / count);
                          const meanDb = meanSquare === 0 ? -91 : 10 * Math.log10(meanSquare / (32768 * 32768));
                          const peakDb = peak === 0 ? -91 : 10 * Math.log10(peak * peak / (32768 * 32768));
                          report += `mean_volume: ${meanDb.toFixed(1)} dB\nmax_volume: ${peakDb.toFixed(1)} dB\n`;
                          let db = 0;
                          while (db < histogram.length && histogram[db] === 0) db++;
                          // Native FFmpeg includes the bin that reaches the loudest 0.1% of samples.
                          for (let sum = 0; db < histogram.length && sum < Math.floor(count / 1000); db++) {
                            report += `histogram_${db}db: ${histogram[db]}\n`;
                            sum += histogram[db]!;
                          }
                        }
                        if (logLevel >= 32) await writeBytes(context.stderr, encodeUtf8(report), context.signal);
                      } else if (trimmed === "volume" || trimmed.startsWith("volume=")) {
                        const argument = trimmed === "volume" ? "1" : trimmed.slice("volume=".length).trim();
                        let volSpec = "1";
                        let precision = "float";
                        let evaluation = "once";
                        let replayGain = "drop";
                        let replayGainPreamp = 0;
                        let replayGainNoClip = true;
                        let enable: string | undefined;
                        for (const [index, option] of argument.split(":").entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? (["volume", "precision", "eval", "replaygain", "replaygain_preamp", "replaygain_noclip"][index] ?? "") : option.slice(0, separator).trim();
                          const value = separator < 0 ? option.trim() : option.slice(separator + 1).trim();
                          if (key === "volume") volSpec = value;
                          else if (key === "precision") precision = value;
                          else if (key === "eval") evaluation = value;
                          else if (key === "replaygain") replayGain = value;
                          else if (key === "replaygain_preamp") {
                            replayGainPreamp = Number(value);
                            if (!value || !Number.isFinite(replayGainPreamp) || Math.abs(replayGainPreamp) > 60) {
                              throw new Error("volume: invalid replaygain_preamp");
                            }
                          } else if (key === "replaygain_noclip") {
                            if (!["0", "1", "false", "true", "no", "yes", "off", "on"].includes(value)) {
                              throw new Error("volume: invalid replaygain_noclip");
                            }
                            replayGainNoClip = ["1", "true", "yes", "on"].includes(value);
                          }
                          else if (key === "enable") enable = value;
                          else throw new Error(`volume: unsupported option ${key}`);
                        }
                        precision = precision === "0" ? "fixed" : precision === "1" ? "float" : precision === "2" ? "double" : precision;
                        evaluation = evaluation === "0" ? "once" : evaluation === "1" ? "frame" : evaluation;
                        if (!["fixed", "float", "double"].includes(precision)) throw new Error("volume: invalid precision");
                        if (precision !== "fixed") statsScale = 1;
                        if (evaluation !== "once" && evaluation !== "frame") throw new Error("volume: invalid eval");
                        replayGain = ["drop", "ignore", "track", "album"][Number(replayGain)] ?? replayGain;
                        if (!["drop", "ignore", "track", "album"].includes(replayGain)) throw new Error("volume: invalid replaygain");
                        let replayGainFactor: number | undefined;
                        if (replayGainAvailable && (replayGain === "track" || replayGain === "album")) {
                          const tags = Object.fromEntries(Object.entries({ ...doc.metadata, ...doc.metadata.custom, ...t.metadata })
                            .map(([key, value]) => [key.toUpperCase(), value]));
                          const gain = (kind: string) => {
                            const value = tags[`REPLAYGAIN_${kind}_GAIN`];
                            return typeof value === "string" ? Number.parseFloat(value) : NaN;
                          };
                          const trackGain = gain("TRACK");
                          const albumGain = gain("ALBUM");
                          if (Number.isFinite(trackGain) || Number.isFinite(albumGain)) {
                            const kind = replayGain === "track" && Number.isFinite(trackGain) ? "TRACK" : "ALBUM";
                            const selectedGain = kind === "TRACK" ? trackGain : Number.isFinite(albumGain) ? albumGain : 0;
                            const peakTag = tags[`REPLAYGAIN_${kind}_PEAK`];
                            const parsedPeak = typeof peakTag === "string" ? Number.parseFloat(peakTag) : NaN;
                            const peak = Number.isFinite(parsedPeak) && parsedPeak > 0 ? parsedPeak : 1;
                            replayGainFactor = Math.pow(10, (selectedGain + replayGainPreamp) / 20);
                            if (replayGainNoClip) replayGainFactor = Math.min(replayGainFactor, 1 / peak);
                          }
                        }
                        // All modes except ignore consume frame ReplayGain side data.
                        if (replayGain !== "ignore") replayGainAvailable = false;
                        const commands = audioCommands.filter(command => command.target === "volume" || command.target === filterTarget)
                          .sort((a, b) => a.sample - b.sample);
                        let nextCommand = 0;
                        const output = stretched.map(channel => precision !== "float"
                          ? new Float64Array(channel.length) : new Float32Array(channel.length));
                        const length = stretched[0]?.length ?? 0;
                        const sampleScale = t.codecDescriptions[0]?.codecName === "pcm_u8" ? 128
                          : t.codecDescriptions[0]?.codecName === "pcm_s16le" ? 32768 : 2147483648;
                        filteredSampleFormat = precision === "float" ? "flt" : precision === "double" ? "dbl"
                          : sampleScale === 128 ? "u8" : sampleScale === 32768 ? "s16" : "s32";
                        panSampleFormat = filteredSampleFormat;
                        const variables: Record<string, number> = { PI: Math.PI, nan: NaN, inf: Infinity, sample_rate: origRate, nb_channels: stretched.length, tb: 1 / origRate,
                          // Native volume leaves sample counters unavailable in both evaluation modes.
                          nb_samples: NaN, nb_consumed_samples: NaN, startpts: NaN, startt: NaN,
                          n: NaN, t: NaN, pts: NaN, volume: NaN };
                        const registers = new Float64Array(10);
                        const evaluateGain = () => {
                          let factor = parseFilterExpression(volSpec, "volume", variables, undefined, registers);
                          if (evaluation === "frame" && Number.isNaN(factor)) factor = 0;
                          if (Number.isNaN(factor)) throw new Error("volume: invalid gain");
                          variables.volume = factor;
                          return factor;
                        };
                        // FFmpeg evaluates during setup before evaluating the first frame.
                        let factor = evaluateGain();
                        if (replayGainFactor !== undefined) factor = replayGainFactor;
                        let startpts = NaN;
                        for (let start = 0, n = 0; start < length; n++) {
                          const packet = t.samples[n];
                          const timestamp = audioTimestamps?.[n];
                          const count = timestamp ? timestamp.end - timestamp.start
                            : packet ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024;
                          const pts = timestamp?.pts ?? (packet ? packet.pts * origRate / t.timescale : audioStartSample + start);
                          if (n === 0) startpts = pts;
                          const end = evaluation === "once" && enable === undefined && commands.length === 0 ? length : Math.min(length, start + count);
                          while (nextCommand < commands.length && commands[nextCommand]!.sample <= start) {
                            volSpec = commands[nextCommand++]!.expression;
                            registers.fill(0);
                            factor = evaluateGain();
                          }
                          if (evaluation === "frame") {
                            Object.assign(variables, { n, t: pts / origRate, pts, startpts, startt: startpts / origRate });
                            factor = evaluateGain();
                          }
                          // Fixed precision uses a Q8 gain; optimized x86 PCM32 rounds ties to even.
                          // PCM8 and PCM16 retain half-up rounding.
                          const fixedGain = Math.max(0, Math.floor(factor * 256 + 0.5));
                          const enabled = enable === undefined || Math.abs(parseFilterExpression(enable, "volume enable", {
                            n, t: pts / origRate
                          })) >= 0.5;
                          for (let c = 0; c < stretched.length; c++) {
                            const channel = stretched[c]!;
                            for (let i = start; i < end; i++) {
                              if (++work % 1024 === 0) { await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                              output[c]![i] = !enabled ? channel[i]! : precision === "fixed"
                                ? Math.max(-sampleScale, Math.min(sampleScale - 1,
                                    (sampleScale === 2147483648 ? roundToEven(channel[i]! * sampleScale * fixedGain / 256)
                                      : Math.floor((channel[i]! * sampleScale * fixedGain + 128) / 256)))) / sampleScale
                                : channel[i]! * (precision === "float" ? Math.fround(factor) : factor);
                            }
                          }
                          start = end;
                        }
                        stretched = output;
                      } else if (trimmed === "acontrast" || trimmed.startsWith("acontrast=")) {
                        let contrast = 33;
                        const argument = trimmed.slice("acontrast=".length);
                        const options = argument.split(":");
                        if (options.at(-1) === "") options.pop();
                        for (const [index, option] of options.entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? (index === 0 ? "contrast" : "") : option.slice(0, separator).trim();
                          const raw = (separator < 0 ? option : option.slice(separator + 1)).trim();
                          if (key === "enable") throw new Error("acontrast: timeline is unsupported");
                          if (key && key !== "contrast") throw new Error("acontrast: unknown option");
                          const value = parseFilterExpression(raw, "acontrast", { PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2 });
                          if (key !== "contrast" || !raw) {
                            throw new Error("acontrast: expected contrast between 0 and 100");
                          }
                          if (Number.isNaN(value)) throw new Error("acontrast: invalid expression");
                          if (!Number.isFinite(value) || value < 0 || value > 100) {
                            throw new RangeError("acontrast: contrast outside 0 to 100");
                          }
                          contrast = Math.fround(value);
                        }
                        filteredSampleFormat = "flt";
                        const amount = Math.fround(contrast / 750);
                        for (const channel of stretched) {
                          for (let i = 0; i < channel.length; i++) {
                            if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                            // Native PCM uses the float transfer, including intermediate rounding.
                            const angle = Math.fround(channel[i]! * Math.PI / 2);
                            channel[i] = Math.fround(Math.sin(Math.fround(angle + Math.fround(amount * Math.fround(Math.sin(angle * 4))))));
                          }
                        }
                      } else if (trimmed === "dcshift" || trimmed.startsWith("dcshift=")) {
                        const argument = trimmed === "dcshift" ? "0" : trimmed.slice("dcshift=".length).trim();
                        let shift = 0;
                        let limitergain = 0;
                        let enable: string | undefined;
                        const options = argument.split(":");
                        if (options.at(-1) === "") options.pop();
                        for (const [index, option] of options.entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? ["shift", "limitergain"][index] : option.slice(0, separator).trim();
                          const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
                          if (key === "enable") {
                            enable = value;
                            parseFilterExpression(enable, "dcshift enable", { n: 0, t: 0 });
                          } else if (key === "shift") {
                            shift = parseFilterExpression(value, "dcshift", { PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2 });
                            if (shift < -1 || shift > 1) {
                              throw new RangeError("dcshift: expected shift between -1 and 1");
                            }
                          } else if (key === "limitergain") {
                            limitergain = Number(value);
                            if (!value || !Number.isFinite(limitergain) || limitergain < 0 || limitergain > 1) {
                              throw new Error("dcshift: expected limitergain between 0 and 1");
                            }
                          } else throw new Error(`dcshift: unsupported option ${key}`);
                        }
                        const threshold = 2147483647 * (1 - (Math.abs(shift) - limitergain));
                        // Native dcshift negotiates signed PCM32 and truncates the shifted sum.
                        // Keep all 32 bits so integer encoders can discard low bits when narrowing.
                        budget.allocateMemory((stretched[0]?.length ?? 0) * stretched.length * Float64Array.BYTES_PER_ELEMENT);
                        const output = stretched.map(channel => new Float64Array(channel.length));
                        const length = stretched[0]?.length ?? 0;
                        for (let start = 0, n = 0; start < length; n++) {
                          const packet = t.samples[n];
                          const timestamp = audioTimestamps?.[n];
                          const count = timestamp ? timestamp.end - timestamp.start
                            : packet ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024;
                          const pts = timestamp?.pts ?? (packet ? packet.pts * origRate / t.timescale : audioStartSample + start);
                          const end = enable === undefined ? length : Math.min(length, start + count);
                          const enabled = enable === undefined || Math.abs(parseFilterExpression(enable, "dcshift enable", {
                            n, t: pts / origRate
                          })) >= 0.5;
                          for (const [c, channel] of stretched.entries()) {
                            for (let i = start; i < end; i++) {
                              if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                              const sample = Math.max(-2147483648, Math.min(2147483647, roundToEven(channel[i]! * 2147483648)));
                              let shifted = sample + shift * (limitergain > 0 ? 2147483647 : 2147483648);
                              // Native limiting uses PCM32 units, including the unscaled peak offset.
                              if (limitergain > 0 && shift > 0 && sample > threshold) {
                                shifted = (sample - threshold) * limitergain / (2147483647 - threshold) + threshold + shift;
                              } else if (limitergain > 0 && shift < 0 && sample < -threshold) {
                                shifted = (sample + threshold) * limitergain / (2147483647 - threshold) - threshold + shift;
                              }
                              output[c]![i] = enabled
                                ? Math.max(-2147483648, Math.min(2147483647, Math.trunc(shifted))) / 2147483648 : sample / 2147483648;
                            }
                          }
                          start = end;
                        }
                        stretched = output;
                        filteredSampleFormat = "s32p";
                        statsScale = 2147483648 / 2147483647;
                        t = { ...t, codecDescriptions: t.codecDescriptions.map(description => ({ ...description,
                          codecName: "pcm_s32le", bitsPerSample: 32 })) };
                      } else if (trimmed === "aloop" || trimmed.startsWith("aloop=")) {
                        const values: Record<string, number> = { loop: 0, size: 0, start: 0, time: Infinity };
                        const argument = trimmed.slice("aloop=".length);
                        let optionPosition = 0;
                        for (const option of (argument ? argument.split(":") : [])) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? ["loop", "size", "start", "time"][optionPosition] : option.slice(0, separator).trim();
                          // Named options restart shorthand, skipping the first slot only
                          // when it was the slot just visited, regardless of the named key.
                          if (separator < 0) optionPosition++;
                          else optionPosition = optionPosition === 0 ? 1 : 0;
                          const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
                          if (!key || !Object.hasOwn(values, key)) throw new Error(`aloop: unsupported option ${key}`);
                          const number = key === "time" ? parseHlsDuration(value) : parseFilterExpression(value, "aloop", { PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2 });
                          if (!value || !Number.isFinite(number) ||
                            (key !== "time" && number > (key === "start" ? 2 ** 63 : 2147483647)) ||
                            number < (key === "start" || key === "loop" ? -1 : 0) ||
                            (key === "time" && number > (2 ** 63 - 1) / 1_000_000)) {
                            throw new Error(`aloop: invalid ${key}`);
                          }
                          values[key] = key === "time" ? number : roundToEven(number);
                        }
                        const { loop, size, start, time } = values;
                        if (loop === -1 && size! > 0) {
                          if (start !== 0) throw new Error("aloop: indefinite loops require start=0");
                          const regionLength = Math.min(size!, stretched[0]?.length ?? 0);
                          if (regionLength === 0) continue;
                          const firstPts = audioTimestamps?.[0]?.pts ?? audioStartSample;
                          const endSeconds = outputDuration === undefined ? outputTo : (outputSs ?? 0) + outputDuration;
                          let length = endSeconds === undefined ? Infinity
                            : Math.max(0, Math.round(endSeconds * origRate) - Math.min(firstPts, Math.round((outputSs ?? 0) * origRate)));
                          if (maxAudioFrames !== undefined) {
                            const framesPerLoop = Math.ceil(regionLength / 1024);
                            length = Math.min(length, Math.floor(maxAudioFrames / framesPerLoop) * regionLength
                              + (maxAudioFrames % framesPerLoop) * 1024);
                          }
                          const next = audioFilters[filterIndex + 1];
                          if (next?.split("=", 1)[0]!.split("@", 1)[0] === "atrim") {
                            const { duration, startPts, endPts, startSample, endSample } = parseAtrim(
                              next.includes("=") ? next.slice(next.indexOf("=") + 1) : "", origRate);
                            const start = Math.min(startPts - firstPts, startSample);
                            const end = Math.max(endSample, endPts - firstPts,
                              duration > 0 ? (start === Infinity ? 0 : start) + duration : -Infinity);
                            if (Number.isFinite(end)) length = Math.min(length, Math.max(0, end));
                          }
                          if (!Number.isSafeInteger(length)) throw new Error("aloop: a finite consumer limit is required");
                          budget.checkDuration(length / origRate);
                          budget.allocateMemory(length * stretched.length * Float32Array.BYTES_PER_ELEMENT);
                          audioTimestamps = [];
                          for (let start = 0; start < length;) {
                            if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                            const end = Math.min(length, start + Math.min(1024, regionLength - start % regionLength));
                            budget.allocateMemory(24);
                            audioTimestamps.push({ start, end, pts: firstPts + start });
                            start = end;
                          }
                          stretched = await mapWork(stretched, async channel => {
                            const output = new Float32Array(length);
                            for (let offset = 0; offset < length; offset += 16384) {
                              await yieldTurn(context.signal);
                              context.signal?.throwIfAborted();
                              budget.checkCpu();
                              for (let i = offset; i < Math.min(length, offset + 16384); i++) output[i] = channel[i % regionLength]!;
                            }
                            return output;
                          }, context.signal);
                          continue;
                        }
                        const loopStart = start === -1 ? Math.round(time! * origRate) : start!;
                        if (size! > 0 && loopStart < (stretched[0]?.length ?? 0)) {
                          const inputLength = stretched[0]?.length ?? 0;
                          let regionLength = Math.min(size!, inputLength - loopStart);
                          let regionEnd = loopStart + regionLength;
                          const regions = [{ start: loopStart, end: regionEnd }];
                          if (loop! > 0 && start! > 0) {
                            regions.length = 0;
                            regionLength = 0;
                            let consumed = 0;
                            let ignored = 0;
                            // Native aloop requests at most 1024 samples, rechecking the
                            // start against ignored samples even after collection begins.
                            while (consumed < inputLength && regionLength < size!) {
                              if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                              const count = Math.min(1024, size! - regionLength, inputLength - consumed);
                              if (ignored + count > start!) {
                                const first = consumed + (regionLength === 0 ? start! - ignored : 0);
                                const last = regions[regions.length - 1];
                                if (last?.end === first) last.end = consumed + count;
                                else regions.push({ start: first, end: consumed + count });
                                regionLength += consumed + count - first;
                              } else {
                                ignored += count;
                              }
                              consumed += count;
                            }
                            regionEnd = consumed;
                          }
                          const repeatedLength = regionLength * loop!;
                          const length = inputLength + repeatedLength;
                          if (!Number.isSafeInteger(length)) throw new Error("aloop: output sample count is too large");
                          budget.checkDuration(length / origRate);
                          const previous = audioTimestamps;
                          audioTimestamps = [];
                          // Keep incoming frames, splitting at the loop boundary. The cached
                          // region is replayed in frames of at most 1024 samples.
                          for (let offset = 0, n = 0; offset < inputLength; n++) {
                            if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                            const frame = previous?.[n];
                            const packet = t.samples[n];
                            const count = frame ? frame.end - frame.start
                              : packet ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024;
                            const end = Math.min(inputLength, offset + count);
                            const pts = frame?.pts ?? (packet ? packet.pts * origRate / t.timescale : audioStartSample + offset);
                            if (offset < regionEnd) {
                              const prefixEnd = Math.min(end, regionEnd);
                              budget.allocateMemory(24);
                              audioTimestamps.push({ start: offset, end: prefixEnd, pts });
                              if (prefixEnd === regionEnd) {
                                for (let repeat = 0; repeat < loop!; repeat++) {
                                  for (let sample = 0; sample < regionLength; sample += 1024) {
                                    if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                                    const start = regionEnd + regionLength * repeat + sample;
                                    budget.allocateMemory(24);
                                    audioTimestamps.push({ start, end: start + Math.min(1024, regionLength - sample),
                                      pts: pts + prefixEnd - offset + repeat * regionLength + sample });
                                  }
                                }
                              }
                            }
                            if (end > regionEnd) {
                              const tailStart = Math.max(offset, regionEnd);
                              budget.allocateMemory(24);
                              audioTimestamps.push({ start: tailStart + repeatedLength, end: end + repeatedLength,
                                pts: pts + tailStart - offset + repeatedLength });
                            }
                            offset = end;
                          }
                          budget.allocateMemory(length * stretched.length * Float32Array.BYTES_PER_ELEMENT);
                          stretched = await mapWork(stretched, async channel => {
                            const output = new Float32Array(length);
                            let regionIndex = 0;
                            let source = regions[0]!.start;
                            for (let offset = 0; offset < length; offset += 16384) {
                              await yieldTurn(context.signal);
                              context.signal?.throwIfAborted();
                              budget.checkCpu();
                              const end = Math.min(length, offset + 16384);
                              for (let i = offset; i < end; i++) {
                                if (i < regionEnd) output[i] = channel[i]!;
                                else if (i < regionEnd + repeatedLength) {
                                  output[i] = channel[source++]!;
                                  if (source === regions[regionIndex]!.end) {
                                    regionIndex = (regionIndex + 1) % regions.length;
                                    source = regions[regionIndex]!.start;
                                  }
                                } else output[i] = channel[i - repeatedLength]!;
                              }
                            }
                            return output;
                          }, context.signal);
                        }
                      } else if (trimmed === "aresample" || trimmed.startsWith("aresample=")) {
                        const [key, raw, extra] = trimmed.slice("aresample=".length).split("=");
                        if (trimmed === "aresample" || raw === undefined ||
                          key === "osr" || key === "out_sample_rate" || key === "sample_rate") {
                          const argument = raw ?? key;
                          const rate = trimmed === "aresample" ? 0 : Math.round(parseFilterExpression(argument!, "aresample", {}));
                          if (extra !== undefined || rate < 0 || rate > 2147483647) {
                            throw new Error("aresample: invalid sample rate");
                          }
                          const targetRate = rate || (index === undefined ? undefined : audioRate) || origRate;
                          if (targetRate !== origRate) {
                            const length = Math.ceil((stretched[0]?.length ?? 0) * targetRate / origRate);
                            if (!Number.isSafeInteger(length)) throw new Error("aresample: output sample count is too large");
                            budget.checkDuration(length / targetRate);
                            budget.allocateMemory(length * stretched.length * Float32Array.BYTES_PER_ELEMENT);
                            stretched = await resampleAudio(stretched, length, origRate, targetRate, budget, context.signal);
                            audioStartSample = Math.round(audioStartSample * targetRate / origRate);
                            for (const frame of audioTimestamps ?? []) {
                              if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                              frame.start = Math.round(frame.start * targetRate / origRate);
                              frame.end = Math.round(frame.end * targetRate / origRate);
                              frame.pts = Math.round(frame.pts * targetRate / origRate);
                            }
                            origRate = targetRate;
                          }
                          continue;
                        }
                        if (key === "lfe_mix_level") {
                          lfeLevel = Number(raw);
                          if (!raw?.trim() || extra !== undefined || !Number.isFinite(lfeLevel) || Math.abs(lfeLevel) > 32) {
                            throw new Error("aresample: LFE mix level must be a number between -32 and 32");
                          }
                          continue;
                        }
                        if (key === "rematrix_volume") {
                          remixVolume = Number(raw);
                          if (!raw?.trim() || extra !== undefined || !Number.isFinite(remixVolume) || Math.abs(remixVolume) > 1000) {
                            throw new Error("aresample: rematrix_volume must be a number between -1000 and 1000");
                          }
                          continue;
                        }
                        if (key === "slev" || key === "surround_mix_level") {
                          surroundLevel = Number(raw);
                          if (!raw?.trim() || extra !== undefined || !Number.isFinite(surroundLevel) || Math.abs(surroundLevel) > 32) {
                            throw new Error("aresample: surround mix level must be a number between -32 and 32");
                          }
                          continue;
                        }
                        if (key === "rematrix_maxval") {
                          matrixMaxval = Number(raw);
                          if (!raw?.trim() || extra !== undefined || !Number.isFinite(matrixMaxval) || matrixMaxval < 0 || matrixMaxval > 1000) {
                            throw new Error("aresample: rematrix_maxval must be a number between 0 and 1000");
                          }
                          continue;
                        }
                        if (key === "clev" || key === "center_mix_level") {
                          mixLevel = Number(raw);
                          if (!raw?.trim() || extra !== undefined || !Number.isFinite(mixLevel) || Math.abs(mixLevel) > 32) {
                            throw new Error("aresample: center mix level must be a number between -32 and 32");
                          }
                          continue;
                        }
                        const firstPts = Number(raw);
                        if (key !== "first_pts" || !raw?.trim() || extra !== undefined || !Number.isSafeInteger(firstPts)) {
                          throw new Error("aresample: expected first_pts with an integer sample timestamp");
                        }
                        const start = audioTimestamps?.[0]?.pts ?? audioStartSample;
                        const offset = start - firstPts;
                        // libswresample's default minimum compensation is 1 ms.
                        if (Math.abs(offset) / origRate > 0.001) {
                          const inputLength = stretched[0]?.length ?? 0;
                          const length = Math.max(0, inputLength + offset);
                          if (!Number.isSafeInteger(length)) throw new Error("aresample: output sample count is too large");
                          budget.checkDuration(length / origRate);
                          if (offset > 0) {
                            budget.allocateMemory(length * stretched.length * Float64Array.BYTES_PER_ELEMENT);
                            stretched = await mapWork(stretched, async channel => {
                              const output = new Float64Array(length);
                              for (let i = 0; i < channel.length; i += 16384) {
                                await yieldTurn(context.signal);
                                context.signal?.throwIfAborted();
                                budget.checkCpu();
                                output.set(channel.subarray(i, i + 16384), offset + i);
                              }
                              return output;
                            }, context.signal);
                          } else {
                            stretched = stretched.map(channel => channel.subarray(Math.min(inputLength, -offset)));
                          }
                        }
                        audioStartSample = firstPts;
                        audioTimestamps = undefined;
                      } else if (trimmed === "apad" || trimmed.startsWith("apad=")) {
                        const options: Record<string, number | undefined> = {};
                        let packetSize = 4096;
                        let enable: string | undefined;
                        const names = ["packet_size", "pad_len", "whole_len", "pad_dur", "whole_dur"];
                        const argument = trimmed.slice("apad=".length);
                        const optionTokens: string[] = [];
                        let option = "";
                        let quoted = false;
                        // Decode the option layer after parseFilterChain decoded the graph layer.
                        for (let i = 0; i < argument.length; i++) {
                          const char = argument[i]!;
                          if (char === "'") quoted = !quoted;
                          else if (!quoted && char === "\\" && i + 1 < argument.length) option += argument[++i]!;
                          else if (!quoted && char === ":") {
                            optionTokens.push(option);
                            option = "";
                          } else option += char;
                        }
                        if (argument) optionTokens.push(option);
                        let optionPosition = 0;
                        for (const option of optionTokens) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? names[optionPosition] : option.slice(0, separator).trim();
                          // Named options restart shorthand, skipping the first slot only
                          // when it was the slot just visited, regardless of the named key.
                          if (separator < 0) optionPosition++;
                          else optionPosition = optionPosition === 0 ? 1 : 0;
                          const value = separator < 0 ? option : option.slice(separator + 1);
                          if (key === "enable") {
                            enable = value;
                            parseFilterExpression(enable, "apad enable", { n: 0, t: 0, pos: 0, w: 0, h: 0, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2 });
                            continue;
                          }
                          if (key === "packet_size") {
                            const number = parseFilterExpression(value, "apad packet_size", { PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2 });
                            packetSize = roundToEven(number);
                            if (number < 0 || number > 2147483647) {
                              throw new Error("apad: invalid packet_size");
                            }
                            continue;
                          }
                          if (!names.includes(key!)) {
                            throw new Error(`apad: unsupported option ${key}`);
                          }
                          const duration = key!.endsWith("_dur");
                          const number = duration ? parseHlsDuration(value ?? "") : parseFilterExpression(value ?? "", "apad", { PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2 });
                          const samples = duration ? Math.round(number * origRate) : roundToEven(number);
                          if (number < (duration ? -0.000001 : -1)) {
                            throw new RangeError(`apad: invalid ${key}`);
                          }
                          if (!value?.trim() || !Number.isSafeInteger(samples)) {
                            throw new Error(`apad: invalid ${key}`);
                          }
                          options[key!] = (duration ? number === -0.000001 : samples === -1) ? undefined : samples;
                        }
                        const padding = options.pad_dur ?? options.pad_len;
                        let minimum = options.whole_dur ?? options.whole_len;
                        // FFmpeg rejects only explicit sample-count conflicts, before duration overrides.
                        if (options.pad_len !== undefined && options.whole_len !== undefined) {
                          throw new Error("apad: pad_len and whole_len are mutually exclusive");
                        }
                        const inputLength = stretched[0]?.length ?? 0;
                        if (!audioTimestamps) {
                          audioTimestamps = [];
                          for (let start = 0, n = 0; start < inputLength; n++) {
                            if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                            const packet = t.samples[n];
                            const count = packet ? Math.max(0, Math.round(packet.duration * origRate / t.timescale)
                              - (packet.skipSamples ?? 0) - (packet.discardPadding ?? 0)) : 1024;
                            if (count === 0) continue;
                            const end = Math.min(inputLength, start + count);
                            budget.allocateMemory(32);
                            audioTimestamps.push({ start, end, pts: audioStartSample + start, pos: packet?.offset });
                            start = end;
                          }
                        }
                        const lastFrame = audioTimestamps.at(-1);
                        const samplesPerTick = (audioTimeBase ?? 1 / origRate) * origRate;
                        // apad rescales each frame's duration to input ticks before advancing PTS.
                        let paddingPts = lastFrame ? lastFrame.pts
                          + Math.round((lastFrame.end - lastFrame.start) / samplesPerTick) * samplesPerTick : 0;
                        if (padding === undefined && minimum === undefined) {
                          let nextIndex = filterIndex + 1;
                          let reframed = false;
                          for (; nextIndex < audioFilters.length; nextIndex++) {
                            if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                            const name = audioFilters[nextIndex]!.split("=", 1)[0]!.split("@", 1)[0];
                            if (name === "asetnsamples") reframed = true;
                            else if (!["anull", "acopy", "volume"].includes(name!)) break;
                          }
                          const next = audioFilters[nextIndex];
                          if (outputDuration === undefined && outputTo === undefined && maxAudioFrames === undefined && next?.split("=", 1)[0]!.split("@", 1)[0] === "atrim") {
                            const { duration, startPts, endPts, startSample, endSample } = parseAtrim(
                              next.includes("=") ? next.slice(next.indexOf("=") + 1) : "", origRate);
                            const frames = audioTimestamps ?? [{ start: 0, end: inputLength, pts: audioStartSample }];
                            let firstPts: number | undefined;
                            for (const frame of frames) {
                              if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                              let start = Math.min(startPts - frame.pts, startSample - frame.start);
                              if (start === Infinity) start = 0;
                              if (start < frame.end - frame.start) {
                                firstPts = frame.pts + start;
                                break;
                              }
                            }
                            let start = Math.min(startPts - paddingPts, startSample - inputLength);
                            if (start === Infinity) start = 0;
                            firstPts ??= paddingPts + start;
                            // atrim keeps samples until every end condition is satisfied.
                            const end = Math.max(endSample, inputLength + endPts - paddingPts,
                              duration > 0 ? inputLength + firstPts + duration - paddingPts : -Infinity);
                            // Reframing preserves sample positions but can change discontinuous PTS.
                            // Only sample end bounds are safe to propagate through asetnsamples.
                            if (Number.isFinite(end) && (!reframed || endPts === -Infinity && duration === 0)) {
                              minimum = Math.max(0, end);
                            }
                          }
                          if (minimum === undefined) {
                            const duration = outputDuration ?? (outputTo === undefined ? undefined : outputTo - (outputSs ?? 0));
                            if (duration === undefined && maxAudioFrames === undefined) {
                              throw new Error("apad: a finite padding or minimum length is required");
                            }
                            // Output duration starts at the first retained frame, or the output seek if later.
                            const seek = Math.round((outputSs ?? 0) * origRate);
                            const firstPts = Math.max(audioTimestamps[0]?.pts ?? audioStartSample,
                              outputSs === undefined ? -Infinity : seek);
                            // Padding starts at the final frame's end, which can differ from the sample count.
                            minimum = duration === undefined ? Infinity
                              : inputLength + Math.max(0, firstPts + Math.round(duration * origRate) - paddingPts);
                            if (maxAudioFrames !== undefined) {
                              // The output cap counts regrouped frames, not apad's packets.
                              const reframe = audioFilters[filterIndex + 1];
                              const frameSamples = reframe?.split("=", 1)[0]!.split("@", 1)[0] === "asetnsamples"
                                ? parseAsetnsamples(reframe.includes("=") ? reframe.slice(reframe.indexOf("=") + 1) : "").size
                                : undefined;
                              minimum = Math.min(minimum, frameSamples === undefined
                                ? inputLength + Math.max(0, maxAudioFrames - audioTimestamps.length) * packetSize
                                : maxAudioFrames * frameSamples);
                            }
                          }
                        }
                        const length = padding !== undefined ? inputLength + padding : Math.max(inputLength, minimum!);
                        if (packetSize === 0 && length > inputLength) {
                          throw new Error("apad: packet_size must be positive when padding is required");
                        }
                        budget.checkDuration(length / origRate);
                        // apad forwards every input frame; the final enable state controls EOF padding.
                        let enabled = true;
                        if (enable !== undefined) {
                          for (const [n, frame] of audioTimestamps.entries()) {
                            if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                            enabled = Math.abs(parseFilterExpression(enable, "apad enable", {
                              n, t: frame.pts / origRate, pos: frame.pos ?? NaN, w: 0, h: 0, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
                            })) >= 0.5;
                          }
                        }
                        if (!enabled || length === inputLength) continue;
                        budget.allocateMemory(Math.ceil((length - inputLength) / packetSize) * 24);
                        for (let start = inputLength; start < length; start += packetSize) {
                          if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                          const end = Math.min(length, start + packetSize);
                          audioTimestamps.push({ start, end, pts: paddingPts });
                          paddingPts += Math.round((end - start) / samplesPerTick) * samplesPerTick;
                        }
                        stretched = await mapWork(stretched, async channel => {
                          budget.allocateMemory(length * channel.BYTES_PER_ELEMENT);
                          const output = channel instanceof Float64Array ? new Float64Array(length) : new Float32Array(length);
                          for (let start = 0; start < channel.length; start += 16384) {
                            await yieldTurn(context.signal);
                            context.signal?.throwIfAborted();
                            budget.checkCpu();
                            output.set(channel.subarray(start, start + 16384), start);
                          }
                          return output;
                        }, context.signal);
                      } else if (trimmed === "adelay" || trimmed.startsWith("adelay=")) {
                        let delays = "";
                        let all = false;
                        let enable: string | undefined;
                        let optionPosition = 0;
                        for (const option of trimmed.slice("adelay=".length).split(":")) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? ["delays", "all"][optionPosition] : option.slice(0, separator).trim();
                          // Named options restart shorthand, skipping the first slot only
                          // when it was the slot just visited, regardless of the named key.
                          if (separator < 0) optionPosition++;
                          else optionPosition = optionPosition === 0 ? 1 : 0;
                          const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
                          if (key === "delays") delays = value;
                          else if (key === "all") {
                            all = parseFilterBoolean(value || "invalid", "adelay: invalid all option");
                          } else if (key === "enable") {
                            enable = value;
                            parseFilterExpression(enable, "adelay enable", { n: 0, t: 0, pos: 0, w: 0, h: 0, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2, NaN, INF: Infinity });
                          } else throw new Error(`adelay: unsupported option ${key}`);
                        }
                        const values = delays.split("|").filter(value => value !== "");
                        if (values.length === 0) continue;
                        const offsets = stretched.map((_, channel) => {
                          const value = (values[channel] ?? (all ? values.at(-1)! : "0")).trimStart();
                          // Native reads a signed integer and its next character for S/s
                          // units, otherwise using a floating-point prefix in milliseconds.
                          let end = value[0] === "+" || value[0] === "-" ? 1 : 0;
                          const start = end;
                          while (end < value.length && value[end]! >= "0" && value[end]! <= "9") end++;
                          const unit = end > start ? value[end] : undefined;
                          let delay = Number.parseFloat(value);
                          if (value.slice(start, start + 2).toLowerCase() === "0x") {
                            let position = start + 2;
                            let mantissa = 0;
                            let scale = 1;
                            let fraction = false;
                            let digits = 0;
                            while (position < value.length) {
                              const character = value[position]!.toLowerCase();
                              const digit = "0123456789abcdef".indexOf(character);
                              if (digit >= 0) {
                                mantissa = mantissa * 16 + digit;
                                if (fraction) scale *= 16;
                                digits++;
                              } else if (character === "." && !fraction) fraction = true;
                              else break;
                              position++;
                            }
                            if (digits > 0) {
                              let exponent = 0;
                              if (value[position]?.toLowerCase() === "p") {
                                exponent = Number.parseInt(value.slice(position + 1), 10);
                                if (Number.isNaN(exponent)) exponent = 0;
                              }
                              delay = (value[0] === "-" ? -1 : 1) * (mantissa / scale) * 2 ** exponent;
                            }
                          }
                          const offset = unit === "S" ? delay
                            : Math.trunc(Math.fround(Math.fround(Math.fround(delay) * origRate) / (unit === "s" ? 1 : 1000)));
                          if (!Number.isFinite(delay) || offset < 0 || !Number.isSafeInteger(offset)) {
                            throw new Error(`adelay: invalid delay ${value}`);
                          }
                          return offset;
                        });
                        const inputLength = stretched[0]?.length ?? 0;
                        const padding = Math.min(...offsets);
                        const length = inputLength + Math.max(0, ...offsets);
                        budget.checkDuration(length / origRate);
                        budget.allocateMemory((length * stretched.length + offsets.reduce((sum, offset) => sum + offset - padding, 0)) * Float64Array.BYTES_PER_ELEMENT);
                        const output = stretched.map(() => new Float64Array(length));
                        const history = offsets.map(offset => new Float64Array(offset - padding));
                        const previous = audioTimestamps;
                        audioTimestamps = [];
                        let nextPts = previous?.[0]?.pts ?? (t.samples[0] ? t.samples[0].pts * origRate / t.timescale : audioStartSample);
                        let enabled = true;
                        let position = 0;
                        // Common silence is unconditional. Bypassed input freezes the delay
                        // buffers; EOF drains them using the final input frame's enable state.
                        for (let start = 0, n = 0; start < length;) {
                          budget.checkCpu();
                          await yieldTurn(context.signal);
                          context.signal?.throwIfAborted();
                          let end: number;
                          let pts = nextPts;
                          if (start < padding) {
                            end = Math.min(padding, start + 2048);
                            nextPts += end - start;
                          } else {
                            if (start < padding + inputLength) {
                              const frame = previous?.[n];
                              const packet = t.samples[n];
                              const count = frame ? frame.end - frame.start
                                : packet ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024;
                              const inputPts = frame?.pts ?? (packet ? packet.pts * origRate / t.timescale : audioStartSample + start - padding);
                              enabled = enable === undefined || Math.abs(parseFilterExpression(enable, "adelay enable", {
                                n, t: inputPts / origRate, pos: packet?.offset ?? NaN, w: 0, h: 0, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2, NaN, INF: Infinity
                              })) >= 0.5;
                              n++;
                              end = Math.min(padding + inputLength, start + count);
                              pts = inputPts + (enabled ? padding : 0);
                              if (enabled) nextPts = inputPts + end - start;
                            } else {
                              end = Math.min(length, start + 2048);
                              nextPts += end - start;
                              if (enabled) pts += padding;
                            }
                            for (let i = start; i < end; i++) {
                              if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                              for (let c = 0; c < stretched.length; c++) {
                                const sample = stretched[c]![i - padding] ?? 0;
                                const buffer = history[c]!;
                                if (!enabled || buffer.length === 0) output[c]![i] = sample;
                                else {
                                  const slot = position % buffer.length;
                                  output[c]![i] = buffer[slot]!;
                                  buffer[slot] = sample;
                                }
                              }
                              if (enabled) position++;
                            }
                          }
                          budget.allocateMemory(24);
                          audioTimestamps.push({ start, end, pts });
                          start = end;
                        }
                        stretched = output;
                      } else if (trimmed === "atempo" || trimmed.startsWith("atempo=")) {
                        const argument = trimmed === "atempo" ? "1" : trimmed.slice("atempo=".length).trim();
                        const tempo = parseFilterExpression(argument.startsWith("tempo=") ? argument.slice("tempo=".length) : argument, "atempo", {});
                        if (tempo < 0.5 || tempo > 100) {
                          throw new Error("atempo must be in the range [0.5, 100]");
                        }
                        stretched = tempo === 1
                          ? await filterUnityTempo(stretched, origRate, t.codecDescriptions[0]?.codecName === "pcm_s16le", budget, context.signal)
                          : await stretchAudio(stretched, origRate, tempo, budget, context.signal);
                      } else if (trimmed === "dialoguenhance" || trimmed.startsWith("dialoguenhance=")) {
                        const values = [1, 1, 2];
                        let enable: string | undefined;
                        const names = ["original", "enhance", "voice"];
                        const argument = trimmed.slice("dialoguenhance=".length);
                        for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
                          const separator = option.indexOf("=");
                          if (separator >= 0 && option.slice(0, separator).trim() === "enable") {
                            enable = option.slice(separator + 1).trim();
                            continue;
                          }
                          const key = separator < 0 ? index : names.indexOf(option.slice(0, separator).trim());
                          const value = parseFilterExpression(separator < 0 ? option : option.slice(separator + 1), "dialoguenhance", {});
                          if (key < 0 || key > 2 || !Number.isFinite(value) || value < (key === 2 ? 2 : 0) || value > [1, 3, 32][key]!) {
                            throw new Error("dialoguenhance: invalid option");
                          }
                          values[key] = value;
                        }
                        if (stretched.length === 1 && (!filteredChannelMask || filteredChannelMask === 4)) {
                          const stereo = await panAudio(`stereo|c0=${Math.SQRT1_2}*c0|c1=${Math.SQRT1_2}*c0`,
                            stretched, filteredChannelMask, "flt", budget, context.signal);
                          stretched = stereo.channels;
                        }
                        const commands = audioCommands.filter(command => command.target === "dialoguenhance" || command.target === filterTarget)
                          .sort((a, b) => a.sample - b.sample);
                        const dialogue = await enhanceDialogue(stretched, origRate, values[0]!, values[1]!, values[2]!, budget, context.signal, commands);
                        stretched = dialogue.channels;
                        const length = stretched[0]?.length ?? 0;
                        budget.allocateMemory(Math.ceil(length / dialogue.frameSize) * 24);
                        const previous = audioTimestamps;
                        audioTimestamps = [];
                        let frameIndex = 0;
                        for (let start = 0; start < length; start += dialogue.frameSize) {
                          if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                          while (previous && frameIndex + 1 < previous.length && previous[frameIndex]!.end <= start) frameIndex++;
                          const frame = previous?.[frameIndex];
                          const pts = frame ? frame.pts + start - frame.start : audioStartSample + start;
                          const end = Math.min(length, start + dialogue.frameSize);
                          if (enable !== undefined && !(Math.abs(parseFilterExpression(enable, "dialoguenhance enable", {
                            n: audioTimestamps.length, t: pts / origRate
                          })) >= 0.5)) {
                            stretched[2]!.fill(0, start, end);
                          }
                          audioTimestamps.push({ start, end, pts });
                        }
                        filteredChannelMask = 7;
                        filteredChannelNames = undefined;
                        filteredSampleFormat = "fltp";
                      } else if (trimmed === "crystalizer" || trimmed.startsWith("crystalizer=")) {
                        let intensity = 2;
                        let clip = true;
                        const argument = trimmed.slice("crystalizer=".length);
                        for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? ["i", "c"][index] : option.slice(0, separator).trim();
                          const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
                          if (key === "i") {
                            intensity = Math.fround(parseFilterExpression(value, "crystalizer", {}));
                            if (!Number.isFinite(intensity) || intensity < -10 || intensity > 10) {
                              throw new Error("crystalizer: i must be in the range [-10, 10]");
                            }
                          } else if (key === "c") {
                            if (!["0", "1", "true", "false", "yes", "no", "on", "off"].includes(value)) {
                              throw new Error("crystalizer: invalid clipping option");
                            }
                            clip = ["1", "true", "yes", "on"].includes(value);
                          } else throw new Error(`crystalizer: unsupported option ${key}`);
                        }
                        stretched = await mapWork(stretched, async channel => {
                          budget.allocateMemory(channel.length * Float32Array.BYTES_PER_ELEMENT);
                          const output = new Float32Array(channel.length);
                          const scale = Math.fround(1 / Math.fround(1 - intensity));
                          let previous = 0;
                          for (let i = 0; i < channel.length; i++) {
                            if (i % 4096 === 0) {
                              await yieldTurn(context.signal);
                              context.signal?.throwIfAborted();
                              budget.checkCpu();
                            }
                            const current = Math.fround(channel[i]!);
                            const value = intensity < 0
                              ? Math.fround(Math.fround(current - Math.fround(previous * intensity)) * scale)
                              : Math.fround(current + Math.fround(Math.fround(current - previous) * intensity));
                            previous = intensity < 0 ? value : current;
                            output[i] = clip ? Math.max(-1, Math.min(1, value)) : value;
                          }
                          return output;
                        }, context.signal);
                      } else if (trimmed === "extrastereo" || trimmed.startsWith("extrastereo=")) {
                        let multiplier = 2.5;
                        let clip = true;
                        let enable: string | undefined;
                        const argument = trimmed.slice("extrastereo".length + 1);
                        for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? ["m", "c"][index] : option.slice(0, separator).trim();
                          const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
                          if (key === "m") {
                            multiplier = Math.fround(parseFilterExpression(value, "extrastereo", { E: Math.E, PI: Math.PI, PHI: (1 + Math.sqrt(5)) / 2 }));
                            if (!Number.isFinite(multiplier) || multiplier < -10 || multiplier > 10) {
                              throw new Error("extrastereo: m must be in the range [-10, 10]");
                            }
                          } else if (key === "c") {
                            clip = parseFilterBoolean(value, "extrastereo: invalid clipping option");
                          } else if (key === "enable") enable = value;
                          else throw new Error(`extrastereo: unsupported option ${key}`);
                        }
                        if (stretched.length !== 2) throw new Error("extrastereo: stereo input required");
                        if (filteredChannelMask && filteredChannelMask !== 3 && filteredChannelMask !== 12) {
                          throw new Error(`extrastereo: unsupported input channel layout (mask ${filteredChannelMask})`);
                        }
                        const commands = audioCommands.filter(command => command.target === "extrastereo" || command.target === filterTarget)
                          .sort((a, b) => a.sample - b.sample);
                        // Native sends a command to the first matching filter instance.
                        audioCommands = audioCommands.filter(command => command.target !== "extrastereo" && command.target !== filterTarget);
                        let nextCommand = 0;
                        const output = stretched.map(channel => new Float32Array(channel.length));
                        let frameEnd = 0;
                        let frameIndex = 0;
                        let enabled = true;
                        for (let i = 0; i < stretched[0]!.length; i++) {
                          if (enable !== undefined && i >= frameEnd) {
                            const packet = t.samples[frameIndex];
                            const timestamp = audioTimestamps?.[frameIndex];
                            const frameLength = timestamp ? timestamp.end - timestamp.start
                              : packet ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024;
                            const pts = timestamp?.pts ?? (packet ? packet.pts * origRate / t.timescale : audioStartSample + i);
                            enabled = Math.abs(parseFilterExpression(enable, "extrastereo enable", {
                              n: frameIndex, t: pts / origRate
                            })) >= 0.5;
                            frameEnd = i + frameLength;
                            frameIndex++;
                          }

                          if (i % 4096 === 0) {
                            await yieldTurn(context.signal);
                            context.signal?.throwIfAborted();
                            budget.checkCpu();
                          }
                          while (nextCommand < commands.length && commands[nextCommand]!.sample <= i) {
                            const command = commands[nextCommand++]!;
                            try {
                              const value = Math.fround(parseFilterExpression(command.expression, "extrastereo", { E: Math.E, PI: Math.PI, PHI: (1 + Math.sqrt(5)) / 2 }));
                              if (Number.isFinite(value) && value >= -10 && value <= 10) multiplier = value;
                            } catch { /* Rejected runtime commands leave the current width unchanged. */ }
                          }
                          const left = filteredChannelMask === 12 ? Math.fround(stretched[0]![i]! * Math.SQRT1_2) : stretched[0]![i]!;
                          const right = filteredChannelMask === 12 ? left : stretched[1]![i]!;
                          if (!enabled) {
                            output[0]![i] = left;
                            output[1]![i] = right;
                            continue;
                          }
                          const average = Math.fround(Math.fround(left + right) / 2);
                          for (let c = 0; c < 2; c++) {
                            const value = Math.fround(average + Math.fround(multiplier * Math.fround((c === 0 ? left : right) - average)));
                            output[c]![i] = clip ? Math.max(-1, Math.min(1, value)) : value;
                          }
                        }
                        stretched = output;
                        filteredChannelMask = 3;
                        filteredChannelNames = undefined;
                        filteredSampleFormat = "flt";
                      } else if (trimmed === "aeval" || trimmed.startsWith("aeval=")) {
                        let expressions = "";
                        let layout = "";
                        let enable: string | undefined;
                        for (const [index, option] of trimmed.slice("aeval=".length).split(":").entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? ["exprs", "channel_layout"][index] : option.slice(0, separator);
                          const value = separator < 0 ? option : option.slice(separator + 1);
                          if (key === "exprs") expressions = value;
                          else if (key === "channel_layout" || key === "c") layout = value;
                          else if (key === "enable") enable = value;
                          else throw new Error(`aeval: unsupported option ${key}`);
                        }
                        const exprs = expressions.split("|").filter(Boolean);
                        const speakers = ["FL", "FR", "FC", "LFE", "BL", "BR", "FLC", "FRC", "BC", "SL", "SR",
                          "TC", "TFL", "TFC", "TFR", "TBL", "TBC", "TBR"];
                        let outputMask = filteredChannelMask;
                        let count = stretched.length;
                        if (layout !== "same") {
                          if (layout) {
                            const digits = layout.startsWith("0x") ? layout.slice(2) : layout;
                            const alphabet = layout.startsWith("0x") ? "0123456789abcdefABCDEF" : "0123456789";
                            if (digits.length && [...digits].every(digit => alphabet.includes(digit))) {
                              outputMask = Number(layout);
                              if (!Number.isSafeInteger(outputMask) || outputMask <= 0 || outputMask >= 1 << speakers.length) {
                                throw new Error("aeval: unsupported channel layout");
                              }
                            } else {
                              const names = parseAudioChannelLayout(layout);
                              if (names.some(name => !speakers.includes(name)) || new Set(names).size !== names.length) {
                                throw new Error("aeval: unsupported channel layout");
                              }
                              outputMask = names.reduce((mask, name) => mask | (1 << speakers.indexOf(name)), 0);
                            }
                          } else {
                            outputMask = [0, 0x4, 0x3, 0xb, 0x107, 0x37, 0x3f, 0x70f, 0x63f][exprs.length] ?? 0;
                          }
                          count = layout ? speakers.filter((_, index) => (outputMask! & (1 << index)) !== 0).length : exprs.length;
                        }
                        if (!count || count > 64 || !exprs.length || exprs.length > count || exprs.some(expr => !expr.trim())) {
                          throw new Error("aeval: unsupported channel layout or invalid expressions");
                        }
                        const output = Array.from({ length: count }, () => new Float64Array(stretched[0]!.length));
                        const registers = Array.from({ length: count }, () => new Float64Array(10));
                        const randomStates = Array.from({ length: count }, () => new Array<BigUint64Array>(10));
                        const variables = { PI: Math.PI, ch: 0, n: 0, t: 0, s: origRate, nb_in_channels: stretched.length, nb_out_channels: count };
                        const sampleValue = (channel: number) => {
                          const index = Math.min(stretched.length - 1, Math.trunc(channel));
                          return index < 0 ? 0 : stretched[index]![variables.n]!;
                        };
                        let frameEnd = 0;
                        let frameIndex = 0;
                        let enabled = true;
                        for (let i = 0; i < stretched[0]!.length; i++) {
                          if (enable !== undefined && i >= frameEnd) {
                            const packet = t.samples[frameIndex];
                            const timestamp = audioTimestamps?.[frameIndex];
                            const frameLength = timestamp ? timestamp.end - timestamp.start
                              : packet ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024;
                            const pts = timestamp?.pts ?? (packet ? packet.pts * origRate / t.timescale : audioStartSample + i);
                            enabled = Math.abs(parseFilterExpression(enable, "aeval enable", {
                              n: frameIndex, t: pts / origRate
                            })) >= 0.5;
                            frameEnd = i + frameLength;
                            frameIndex++;
                          }
                          if (i % 4096 === 0) {
                            await yieldTurn(context.signal);
                            context.signal?.throwIfAborted();
                            budget.checkCpu();
                          }
                          variables.n = i;
                          variables.t = i / origRate;
                          for (let c = 0; c < count; c++) {
                            variables.ch = c;
                            output[c]![i] = !enabled ? sampleValue(c) : parseFilterExpression(exprs[Math.min(c, exprs.length - 1)]!, "aeval", variables, sampleValue, registers[c], randomStates[c]);
                          }
                        }
                        stretched = output;
                        filteredChannelMask = outputMask;
                        filteredChannelNames = undefined;
                      } else if (trimmed === "aformat" || trimmed.startsWith("aformat=")) {
                        const argument = trimmed.slice("aformat=".length);
                        const options = argument ? argument.split(":") : [];
                        if (options.at(-1) === "") options.pop();
                        for (const [index, option] of options.entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? ["sample_fmts", "sample_rates", "channel_layouts"][index] : option.slice(0, separator).trim();
                          const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
                          if (!value) throw new Error(`aformat: unsupported empty value for ${key}`);
                          if (key === "sample_rates" || key === "r") {
                            let targetRate = origRate;
                            let bestDifference = Infinity;
                            for (const raw of value ? value.split("|") : []) {
                              const rate = Number(raw);
                              if (!Number.isInteger(rate) || rate < 1 || rate > 2147483647) {
                                throw new Error("aformat: invalid sample rate");
                              }
                              const difference = Math.abs(rate - origRate);
                              if (difference < bestDifference) {
                                targetRate = rate;
                                bestDifference = difference;
                              }
                            }
                            if (targetRate !== origRate) {
                              const length = Math.ceil((stretched[0]?.length ?? 0) * targetRate / origRate);
                              if (!Number.isSafeInteger(length)) throw new Error("aformat: output sample count is too large");
                              budget.checkDuration(length / targetRate);
                              budget.allocateMemory(length * stretched.length * Float32Array.BYTES_PER_ELEMENT);
                              stretched = await resampleAudio(stretched, length, origRate, targetRate, budget, context.signal);
                              audioStartSample = Math.round(audioStartSample * targetRate / origRate);
                              for (const frame of audioTimestamps ?? []) {
                                if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                                frame.start = Math.round(frame.start * targetRate / origRate);
                                frame.end = Math.round(frame.end * targetRate / origRate);
                                frame.pts = Math.round(frame.pts * targetRate / origRate);
                              }
                              origRate = targetRate;
                            }
                            continue;
                          }
                          if (key === "sample_fmts" || key === "f") {
                            const formats = value.split("|");
                            if (formats.some(format => !["u8", "s16", "s32", "flt", "fltp", "dbl", "dblp"].includes(format))) {
                              throw new Error(`aformat: unsupported sample format ${value}`);
                            }
                            const bytes: Record<string, number> = { u8: 1, s16: 2, s32: 4, flt: 4, dbl: 8 };
                            const source = filteredSampleFormat.endsWith("p") ? filteredSampleFormat.slice(0, -1) : filteredSampleFormat;
                            const score = (format: string) => {
                              const packed = format.endsWith("p") ? format.slice(0, -1) : format;
                              const difference = bytes[packed]! - bytes[source]!;
                              return (format.endsWith("p") === filteredSampleFormat.endsWith("p") ? 0 : 1)
                                + (difference < 0 ? -100 * difference : 10 * difference)
                                + (packed === "s32" && source === "flt" ? 20 : packed === "flt" && source === "s32" ? 2 : 0);
                            };
                            const format = formats.includes(filteredSampleFormat) ? filteredSampleFormat
                              : formats.reduce((best, candidate) => score(best) < score(candidate) ? best : candidate);
                            panSampleFormat = format;
                            const truncate = format === "u8" && ["u8", "u8p", "s16", "s16p", "s32", "s32p"].includes(filteredSampleFormat);
                            filteredSampleFormat = format;
                            if (format === "dbl" || format === "dblp") continue;
                            const floating = format === "flt" || format === "fltp";
                            const scale = format === "u8" ? 128 : format === "s32" ? 2147483648 : 32768;
                            const output = stretched.map(channel => new Float64Array(channel.length));
                            for (let i = 0; i < stretched[0]!.length; i++) {
                              if (i % 4096 === 0) {
                                await yieldTurn(context.signal);
                                context.signal?.throwIfAborted();
                                budget.checkCpu();
                              }
                              for (let c = 0; c < stretched.length; c++) {
                                if (floating) {
                                  output[c]![i] = Math.fround(stretched[c]![i]!);
                                  continue;
                                }
                                const sample = stretched[c]![i]! * scale;
                                // Integer PCM narrows by discarding low bits; floating PCM rounds to nearest even.
                                const lower = Math.floor(sample);
                                const quantized = truncate ? lower : sample - lower === 0.5
                                  ? lower + Math.abs(lower % 2) : Math.round(sample);
                                output[c]![i] = Math.max(-scale, Math.min(scale - 1, quantized)) / scale;
                              }
                            }
                            stretched = output;
                            continue;
                          }
                          if (key !== "channel_layouts" && key !== "cl") throw new Error(`aformat: unsupported option ${key}`);
                          const layouts = value.split("|");
                          if (layouts.some(layout => layout !== "mono" && layout !== "stereo")) {
                            throw new Error(`aformat: unsupported channel layout ${value}`);
                          }
                          if (layouts[0] === "mono" && stretched.length === 1 && (filteredChannelMask === 1 || filteredChannelMask === 2)) {
                            filteredChannelMask = 4;
                            filteredChannelNames = undefined;
                            continue;
                          }
                          const inputLayout = stretched.length === 1 && (!filteredChannelMask || filteredChannelMask === 4) ? "mono"
                            : stretched.length === 2 && (!filteredChannelMask || filteredChannelMask === 3) ? "stereo" : undefined;
                          if (!inputLayout) throw new Error("aformat: layout conversion requires mono or stereo input");
                          if (layouts.includes(inputLayout)) continue;
                          const expression = layouts[0] === "mono" ? "mono|c0=0.5*c0+0.5*c1"
                            : `stereo|c0=${Math.SQRT1_2}*c0|c1=${Math.SQRT1_2}*c0`;
                          const mixed = await panAudio(expression, stretched, filteredChannelMask, panSampleFormat, budget, context.signal);
                          stretched = mixed.channels;
                          filteredChannelMask = mixed.channelMask;
                          filteredChannelNames = undefined;
                        }
                      } else if (trimmed === "pan" || trimmed.startsWith("pan=")) {
                        const panned = await panAudio(trimmed.slice(4), stretched, filteredChannelMask, panSampleFormat, budget, context.signal);
                        stretched = panned.channels;
                        filteredChannelMask = panned.channelMask;
                        filteredChannelNames = panned.channelNames;
                      } else if (trimmed === "crossfeed" || trimmed.startsWith("crossfeed=")) {
                        filteredSampleFormat = "dbl";
                        if (stretched.length === 1 && (!filteredChannelMask || filteredChannelMask === 4)) {
                          const stereo = await panAudio(`stereo|c0=${Math.SQRT1_2}*c0|c1=${Math.SQRT1_2}*c0`,
                            stretched, filteredChannelMask, "flt", budget, context.signal);
                          stretched = stereo.channels;
                          filteredChannelMask = stereo.channelMask;
                          filteredChannelNames = undefined;
                        }
                        if (stretched.length !== 2) throw new Error("crossfeed: stereo input required");
                        let enable: string | undefined;
                        const options = { strength: 0.2, range: 0.5, slope: 0.5, level_in: 0.9, level_out: 1, block_size: 0 };
                        const argument = trimmed.slice("crossfeed=".length);
                        for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? ["strength", "range", "slope", "level_in", "level_out", "block_size"][index] : option.slice(0, separator).trim();
                          if (key === "enable") {
                            enable = option.slice(separator + 1).trim();
                            continue;
                          }
                          if (key !== "strength" && key !== "range" && key !== "slope" && key !== "level_in" && key !== "level_out" && key !== "block_size") {
                            throw new Error(`crossfeed: unsupported option ${key}`);
                          }
                          const value = parseFilterExpression((separator < 0 ? option : option.slice(separator + 1)).trim(), "crossfeed", {});
                          const min = key === "slope" ? 0.01 : 0;
                          const max = key === "block_size" ? 32768 : 1;
                          if (!Number.isFinite(value) || value < min || value > max) {
                            throw new Error(`crossfeed: ${key} must be in the range [${min}, ${max}]`);
                          }
                          options[key] = key === "block_size" ? roundToEven(value) : value;
                        }
                        const commands = audioCommands.filter(command => command.target === "crossfeed" || command.target === filterTarget)
                          .sort((a, b) => a.sample - b.sample);
                        // Native sends each command to the first matching filter instance.
                        audioCommands = audioCommands.filter(command => command.target !== "crossfeed" && command.target !== filterTarget);
                        let nextCommand = 0;
                        // Low-shelf the stereo difference signal, preserving the mid signal.
                        const gain = 10 ** (-30 * options.strength / 40);
                        const omega = 2 * Math.PI * (1 - options.range) * 2100 / origRate;
                        const cosine = Math.cos(omega);
                        const alpha = Math.sin(omega) / 2 * Math.sqrt((gain + 1 / gain) * (1 / options.slope - 1) + 2);
                        const beta = 2 * Math.sqrt(gain) * alpha;
                        const a0 = (gain + 1) + (gain - 1) * cosine + beta;
                        const a1 = -2 * ((gain - 1) + (gain + 1) * cosine) / a0;
                        const a2 = ((gain + 1) + (gain - 1) * cosine - beta) / a0;
                        const b0 = gain * ((gain + 1) - (gain - 1) * cosine + beta) / a0;
                        const b1 = 2 * gain * ((gain - 1) - (gain + 1) * cosine) / a0;
                        const b2 = gain * ((gain + 1) - (gain - 1) * cosine - beta) / a0;
                        let w1 = 0;
                        let w2 = 0;
                        const length = stretched[0]!.length;
                        const size = options.block_size;
                        budget.allocateMemory((length * 2 + size * 2) * Float64Array.BYTES_PER_ELEMENT);
                        const output = stretched.map(channel => new Float64Array(channel.length));
                        if (size === 0) {
                          if (enable !== undefined && length === 0) parseFilterExpression(enable, "crossfeed enable", { n: 0, t: 0 });
                          for (let start = 0, n = 0; start < length; n++) {
                            const packet = t.samples[n];
                            const timestamp = audioTimestamps?.[n];
                            const count = timestamp ? timestamp.end - timestamp.start
                              : packet ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024;
                            const pts = timestamp?.pts ?? (packet ? packet.pts * origRate / t.timescale : audioStartSample + start);
                            const end = enable === undefined ? length : Math.min(length, start + count);
                            const enabled = enable === undefined || Math.abs(parseFilterExpression(enable, "crossfeed enable", {
                              n, t: pts / origRate
                            })) >= 0.5;
                            for (let i = start; i < end; i++) {
                              if (i % 4096 === 0) {
                                await yieldTurn(context.signal);
                                context.signal?.throwIfAborted();
                                budget.checkCpu();
                              }
                              while (nextCommand < commands.length && commands[nextCommand]!.sample <= i) {
                                const command = commands[nextCommand++]!;
                                try {
                                  const value = parseFilterExpression(command.expression, "crossfeed", {});
                                  if (Number.isFinite(value) && value >= 0 && value <= 1) options.level_out = value;
                                } catch { /* Rejected runtime commands leave the current gain unchanged. */ }
                              }
                              const mid = (stretched[0]![i]! + stretched[1]![i]!) * options.level_in * 0.5;
                              const side = (stretched[0]![i]! - stretched[1]![i]!) * options.level_in * 0.5;
                              const filtered = side * b0 + w1;
                              w1 = b1 * side + w2 - a1 * filtered;
                              w2 = b2 * side - a2 * filtered;
                              // Keep the low-shelf history running even when the output is bypassed.
                              output[0]![i] = enabled ? (mid + filtered) * options.level_out : stretched[0]![i]!;
                              output[1]![i] = enabled ? (mid - filtered) * options.level_out : stretched[1]![i]!;
                            }
                            start = end;
                          }
                        } else {
                          // Retain two forward-filtered blocks. A reverse pass over both
                          // supplies lookahead for the older block; EOF also drains the newer one.
                          const forward = new Float64Array(size * 2);
                          const previous = audioTimestamps;
                          budget.allocateMemory((Math.ceil(length / size) + 1) * 24);
                          audioTimestamps = [{ start: 0, end: 0, pts: 0 }];
                          let frameIndex = 0;
                          for (let start = 0; start < length; start += size) {
                            while (previous && frameIndex + 1 < previous.length && previous[frameIndex]!.end <= start) frameIndex++;
                            const frame = previous?.[frameIndex];
                            const pts = frame ? frame.pts + start - frame.start : audioStartSample + start;
                            // Upstream commands arrive while the next input block is filled.
                            while (nextCommand < commands.length && commands[nextCommand]!.sample < Math.min(length, start + size)) {
                              const command = commands[nextCommand++]!;
                              try {
                                const value = parseFilterExpression(command.expression, "crossfeed", {});
                                if (Number.isFinite(value) && value >= 0 && value <= 1) options.level_out = value;
                              } catch { /* Rejected runtime commands leave the current gain unchanged. */ }
                            }
                            const enabled = enable === undefined || Math.abs(parseFilterExpression(enable, "crossfeed enable", {
                              n: start / size, t: pts / origRate
                            })) >= 0.5;
                            for (let i = 0; i < size; i++) {
                              if (++work % 4096 === 0) {
                                budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted();
                              }
                              const side = ((stretched[0]![start + i] ?? 0) - (stretched[1]![start + i] ?? 0)) * options.level_in * 0.5;
                              const filtered = side * b0 + w1;
                              w1 = b1 * side + w2 - a1 * filtered;
                              w2 = b2 * side - a2 * filtered;
                              forward[size + i] = filtered;
                            }
                            let reverseW1 = 0;
                            let reverseW2 = 0;
                            for (let i = size * 2 - 1; i >= 0; i--) {
                              if (++work % 4096 === 0) {
                                budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted();
                              }
                              const side = forward[i]!;
                              const filtered = side * b0 + reverseW1;
                              reverseW1 = b1 * side + reverseW2 - a1 * filtered;
                              reverseW2 = b2 * side - a2 * filtered;
                              const sample = start - size + i;
                              if (sample < 0 || sample >= length || (i >= size && start + size < length)) continue;
                              const mid = (stretched[0]![sample]! + stretched[1]![sample]!) * options.level_in * 0.5;
                              output[0]![sample] = enabled ? (mid + filtered) * options.level_out : sample < start ? stretched[0]![start + i] ?? 0 : 0;
                              output[1]![sample] = enabled ? (mid - filtered) * options.level_out : sample < start ? stretched[1]![start + i] ?? 0 : 0;
                            }
                            forward.copyWithin(0, size);
                            audioTimestamps.push({ start, end: Math.min(length, start + size), pts });
                          }
                        }
                        stretched = output;
                      } else if (trimmed === "earwax") {
                        if (origRate !== 44100) {
                          const length = Math.ceil((stretched[0]?.length ?? 0) * 44100 / origRate);
                          if (!Number.isSafeInteger(length)) throw new Error("earwax: output sample count is too large");
                          budget.checkDuration(length / 44100);
                          budget.allocateMemory(length * stretched.length * Float32Array.BYTES_PER_ELEMENT);
                          stretched = await resampleAudio(stretched, length, origRate, 44100, budget, context.signal);
                          filteredSampleFormat = "flt";
                          panSampleFormat = "flt";
                          audioStartSample = Math.round(audioStartSample * 44100 / origRate);
                          for (const frame of audioTimestamps ?? []) {
                            if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                            frame.start = Math.round(frame.start * 44100 / origRate);
                            frame.end = Math.round(frame.end * 44100 / origRate);
                            frame.pts = Math.round(frame.pts * 44100 / origRate);
                          }
                          origRate = 44100;
                        }
                        if (origRate === 44100 && stretched.length === 1 && (!filteredChannelMask || filteredChannelMask === 4)) {
                          const stereo = await panAudio(`stereo|c0=${Math.SQRT1_2}*c0|c1=${Math.SQRT1_2}*c0`,
                            stretched, filteredChannelMask, panSampleFormat, budget, context.signal);
                          stretched = stereo.channels;
                          filteredChannelMask = stereo.channelMask;
                          filteredChannelNames = undefined;
                        }
                        if (origRate !== 44100 || stretched.length !== 2) {
                          throw new Error("earwax: 44100 Hz stereo input required");
                        }
                        // Earwax FIR coefficients, in oldest-to-newest sample order.
                        // Copyright (c) 2000 Edward Beingessner And Sundry Contributors.
                        // Freely redistributable for any purpose; this notice must be maintained.
                        // The contributors are not responsible for consequences of using this software.
                        const taps = [
                          [4, 4, -1, 3, -2, -5, 9, 6, -4, -5, -2, -7, 6, 30, 12, -11,
                            -3, -20, 2, 1, -14, 15, 6, 15, -14, -7, -4, 6, 6, 0, 0, 4],
                          [-6, -11, -5, 3, 5, 0, 1, 3, -1, -3, -5, 1, -7, -29, -3, 4,
                            7, 23, 0, -6, -5, -18, 7, -10, 22, -2, 9, -12, -6, -11, -5, 0]
                        ];
                        // Native signed integer conversion discards low bits before convolution.
                        const quantize = filteredSampleFormat === "s32" ? Math.floor : roundToEven;
                        const history = [new Int16Array(32), new Int16Array(32)];
                        const output = stretched.map(channel => new Float64Array(channel.length));
                        for (let i = 0; i < stretched[0]!.length; i++) {
                          if (i % 4096 === 0) {
                            await yieldTurn(context.signal);
                            context.signal?.throwIfAborted();
                            budget.checkCpu();
                          }
                          for (let c = 0; c < 2; c++) {
                            let same = 0;
                            let opposite = 0;
                            for (let j = 0; j < 32; j++) {
                              same += history[c]![(i + j) % 32]! * taps[1]![j]!;
                              opposite += history[1 - c]![(i + j) % 32]! * taps[0]![j]!;
                            }
                            // FFmpeg clips each convolution before mixing and clips the sum again.
                            const mixed = Math.max(-32768, Math.min(32767, Math.floor(same / 128)))
                              + Math.max(-32768, Math.min(32767, Math.floor(opposite / 128)));
                            output[c]![i] = Math.max(-32768, Math.min(32767, mixed)) / 32768;
                          }
                          for (let c = 0; c < 2; c++) {
                            history[c]![i % 32] = Math.max(-32768, Math.min(32767, quantize(stretched[c]![i]! * 32768)));
                          }
                        }
                        stretched = output;
                        filteredSampleFormat = "s16p";
                        panSampleFormat = "s16";
                      } else if (trimmed === "haas" || trimmed.startsWith("haas=")) {
                        if (stretched.length === 1 && (!filteredChannelMask || filteredChannelMask === 4)) {
                          const stereo = await panAudio(`stereo|c0=${Math.SQRT1_2}*c0|c1=${Math.SQRT1_2}*c0`,
                            stretched, filteredChannelMask, "flt", budget, context.signal);
                          stretched = stereo.channels;
                          filteredChannelMask = stereo.channelMask;
                          filteredChannelNames = undefined;
                        }
                        if (stretched.length !== 2) throw new Error("haas: stereo input required");
                        const options = {
                          level_in: 1, level_out: 1, side_gain: 1, middle_source: 2, middle_phase: 0,
                          left_delay: 2.05, left_balance: -1, left_gain: 1, left_phase: 0,
                          right_delay: 2.12, right_balance: 1, right_gain: 1, right_phase: 1
                        };
                        const argument = trimmed.slice("haas=".length);
                        for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? Object.keys(options)[index] : option.slice(0, separator).trim();
                          if (!key || !Object.hasOwn(options, key)) throw new Error(`haas: unsupported option ${key}`);
                          const name = key as keyof typeof options;
                          const raw = (separator < 0 ? option : option.slice(separator + 1)).trim();
                          const phase = key.endsWith("_phase");
                          const value = phase
                            ? ["1", "true", "yes", "on"].includes(raw) ? 1
                              : ["0", "false", "no", "off"].includes(raw) ? 0 : NaN
                            : parseFilterExpression(raw, "haas", key === "middle_source"
                              ? { left: 0, right: 1, mid: 2, side: 3 } : {});
                          const delay = key.endsWith("_delay");
                          const balance = key.endsWith("_balance");
                          const min = balance ? -1 : delay || phase || key === "middle_source" ? 0 : 0.015625;
                          const max = balance || phase ? 1 : delay ? 40 : key === "middle_source" ? 3 : 64;
                          if (!Number.isFinite(value) || value < min || value > max) {
                            throw new Error(`haas: ${key} must be in the range [${min}, ${max}]`);
                          }
                          options[name] = key === "middle_source" ? roundToEven(value) : value;
                        }
                        const leftDelay = Math.floor(options.left_delay * 0.001 * origRate);
                        const rightDelay = Math.floor(options.right_delay * 0.001 * origRate);
                        let size = 1;
                        while (size < Math.floor(origRate * 40 * 0.001)) size *= 2;
                        budget.allocateMemory((size + stretched[0]!.length * 2) * Float64Array.BYTES_PER_ELEMENT);
                        const history = new Float64Array(size);
                        const output = stretched.map(channel => new Float64Array(channel.length));
                        const leftGain = options.left_gain * (options.left_phase ? 1 : -1);
                        const rightGain = options.right_gain * (options.right_phase ? 1 : -1);
                        const leftBalance = (options.left_balance + 1) / 2;
                        const rightBalance = (options.right_balance + 1) / 2;
                        for (let i = 0; i < stretched[0]!.length; i++) {
                          if (i % 4096 === 0) {
                            await yieldTurn(context.signal);
                            context.signal?.throwIfAborted();
                            budget.checkCpu();
                          }
                          const left = stretched[0]![i]!;
                          const right = stretched[1]![i]!;
                          let mid = (options.middle_source === 0 ? left : options.middle_source === 1 ? right
                            : options.middle_source === 2 ? (left + right) * 0.5 : (left - right) * 0.5) * options.level_in;
                          // The taps retain the source phase; middle_phase changes only the direct signal.
                          history[i % size] = mid;
                          const leftTap = history[(i + size - leftDelay) % size]! * options.side_gain;
                          const rightTap = history[(i + size - rightDelay) % size]! * options.side_gain;
                          if (options.middle_phase) mid = -mid;
                          output[0]![i] = (mid + (leftTap * (leftBalance * leftGain)
                            - rightTap * (rightBalance * rightGain))) * options.level_out;
                          output[1]![i] = (mid + (rightTap * ((1 - rightBalance) * rightGain)
                            - leftTap * ((1 - leftBalance) * leftGain))) * options.level_out;
                        }
                        stretched = output;
                        filteredSampleFormat = "dbl";
                        panSampleFormat = "flt";
                      } else if (trimmed === "stereowiden" || trimmed.startsWith("stereowiden=")) {
                        filteredSampleFormat = "flt";
                        if (stretched.length !== 2) throw new Error("stereowiden: stereo input required");
                        let enable: string | undefined;
                        const options = { delay: 20, feedback: 0.3, crossfeed: 0.3, drymix: 0.8 };
                        const argument = trimmed.slice("stereowiden=".length);
                        for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? ["delay", "feedback", "crossfeed", "drymix"][index] : option.slice(0, separator).trim();
                          if (key === "enable") {
                            enable = option.slice(separator + 1).trim();
                            continue;
                          }
                          if (key !== "delay" && key !== "feedback" && key !== "crossfeed" && key !== "drymix") {
                            throw new Error(`stereowiden: unsupported option ${key}`);
                          }
                          const value = parseFilterExpression((separator < 0 ? option : option.slice(separator + 1)).trim(), "stereowiden", {});
                          const min = key === "delay" ? 1 : 0;
                          const max = key === "delay" ? 100 : key === "feedback" ? 0.9 : key === "crossfeed" ? 0.8 : 1;
                          if (!Number.isFinite(value) || value < min || value > max) {
                            throw new Error(`stereowiden: ${key} must be in the range [${min}, ${max}]`);
                          }
                          options[key] = value;
                        }
                        // Match native float arithmetic and lrintf's ties-to-even rounding.
                        const delay = roundToEven(Math.fround(Math.fround(origRate * Math.fround(options.delay)) / 1000));
                        let feedback = Math.fround(options.feedback);
                        const commands = audioCommands.filter(command => command.target === "stereowiden" || command.target === filterTarget)
                          .sort((a, b) => a.sample - b.sample);
                        // Native sends each command to the first matching filter instance.
                        audioCommands = audioCommands.filter(command => command.target !== "stereowiden" && command.target !== filterTarget);
                        let nextCommand = 0;
                        const crossfeed = Math.fround(options.crossfeed);
                        const drymix = Math.fround(options.drymix);
                        const output = stretched.map(channel => new Float32Array(channel.length));
                        const length = stretched[0]!.length;
                        for (let start = 0, n = 0; start < length; n++) {
                          const packet = t.samples[n];
                          const timestamp = audioTimestamps?.[n];
                          const count = timestamp ? timestamp.end - timestamp.start
                            : packet ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024;
                          const pts = timestamp?.pts ?? (packet ? packet.pts * origRate / t.timescale : audioStartSample + start);
                          const end = enable === undefined ? length : Math.min(length, start + count);
                          const enabled = enable === undefined || Math.abs(parseFilterExpression(enable, "stereowiden enable", {
                            n, t: pts / origRate
                          })) >= 0.5;
                          for (let i = start; i < end; i++) {
                            if (i % 4096 === 0) {
                              await yieldTurn(context.signal);
                              context.signal?.throwIfAborted();
                              budget.checkCpu();
                            }
                            while (nextCommand < commands.length && commands[nextCommand]!.sample <= i) {
                              const command = commands[nextCommand++]!;
                              try {
                                const value = parseFilterExpression(command.expression, "stereowiden", {});
                                if (Number.isFinite(value) && value >= 0 && value <= 0.9) feedback = Math.fround(value);
                              } catch { /* Rejected runtime commands leave the current feedback unchanged. */ }
                            }
                            for (let c = 0; c < 2; c++) {
                              const opposite = stretched[1 - c]!;
                              // Read delay history from the input, including samples received while bypassed.
                              output[c]![i] = !enabled ? stretched[c]![i]!
                                : Math.fround(Math.fround(drymix * Math.fround(stretched[c]![i]!))
                                  - Math.fround(crossfeed * Math.fround(opposite[i]!)))
                                  - Math.fround(feedback * Math.fround(i >= delay ? opposite[i - delay]! : 0));
                            }
                          }
                          start = end;
                        }
                        stretched = output;
                      } else if (trimmed === "stereotools" || trimmed.startsWith("stereotools=")) {
                        if (stretched.length !== 2) throw new Error("stereotools: stereo input required");
                        const modes = ["lr>lr", "lr>ms", "ms>lr", "lr>ll", "lr>rr", "lr>l+r", "lr>rl", "ms>ll", "ms>rr", "ms>rl", "lr>l-r"];
                        let mode = 0;
                        let delay = 0;
                        let phase = 0;
                        let base = 0;
                        const flags = { mutel: false, muter: false, phasel: false, phaser: false, softclip: false };
                        let sclevel = 1;
                        const levels = { level_in: 1, level_out: 1, mlev: 1, slev: 1 };
                        const balance = { mpan: 0, sbal: 0, balance_in: 0, balance_out: 0 };
                        const balanceModes = { bmode_in: 0, bmode_out: 0 };
                        let enable: string | undefined;
                        const argument = trimmed.slice("stereotools=".length);
                        const positionalKeys = ["level_in", "level_out", "balance_in", "balance_out", "softclip",
                          "mutel", "muter", "phasel", "phaser", "mode", "slev", "sbal", "mlev", "mpan",
                          "base", "delay", "sclevel", "phase", "bmode_in", "bmode_out"];
                        let sawNamed = false;
                        for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? positionalKeys[index] : option.slice(0, separator).trim();
                          if (separator < 0 && (sawNamed || key === undefined)) {
                            throw new Error("stereotools: unsupported positional option");
                          }
                          sawNamed ||= separator >= 0;
                          const value = option.slice(separator + 1).trim();
                          if (key === "level_in" || key === "level_out" || key === "mlev" || key === "slev") {
                            const level = parseFilterExpression(value, "stereotools", {});
                            if (!Number.isFinite(level) || level < 0.015625 || level > 64) {
                              throw new Error(`stereotools: ${key} must be in the range [0.015625, 64]`);
                            }
                            levels[key] = level;
                          } else if (key === "sclevel") {
                            sclevel = parseFilterExpression(value, "stereotools", {});
                            if (!Number.isFinite(sclevel) || sclevel < 1 || sclevel > 100) {
                              throw new Error("stereotools: sclevel must be in the range [1, 100]");
                            }
                          } else if (key === "mpan" || key === "sbal" || key === "balance_in" || key === "balance_out") {
                            const valueNumber = parseFilterExpression(value, "stereotools", {});
                            if (!Number.isFinite(valueNumber) || valueNumber < -1 || valueNumber > 1) {
                              throw new Error(`stereotools: ${key} must be in the range [-1, 1]`);
                            }
                            balance[key] = valueNumber;
                          } else if (key === "bmode_in" || key === "bmode_out") {
                            let balanceMode = ["balance", "amplitude", "power"].indexOf(value);
                            if (balanceMode < 0 && value !== "") balanceMode = Number(value);
                            if (!Number.isInteger(balanceMode) || balanceMode < 0 || balanceMode > 2) {
                              throw new Error(`stereotools: invalid ${key}`);
                            }
                            balanceModes[key] = balanceMode;
                          } else if (key === "base") {
                            base = parseFilterExpression(value, "stereotools", {});
                            if (!Number.isFinite(base) || base < -1 || base > 1) {
                              throw new Error("stereotools: base must be in the range [-1, 1]");
                            }
                          } else if (key === "phase") {
                            phase = parseFilterExpression(value, "stereotools", {});
                            if (!Number.isFinite(phase) || phase < 0 || phase > 360) {
                              throw new Error("stereotools: phase must be in the range [0, 360]");
                            }
                          } else if (key === "delay") {
                            delay = parseFilterExpression(value, "stereotools", {});
                            if (!Number.isFinite(delay) || delay < -20 || delay > 20) {
                              throw new Error("stereotools: delay must be in the range [-20, 20]");
                            }
                          } else if (key === "mode") {
                            mode = modes.indexOf(value);
                            if (mode < 0 && value !== "") mode = Number(value);
                            if (!Number.isInteger(mode) || mode < 0 || mode >= modes.length) {
                              throw new Error("stereotools: invalid mode");
                            }
                          } else if (key === "mutel" || key === "muter" || key === "phasel" || key === "phaser" || key === "softclip") {
                            flags[key] = parseFilterBoolean(value, `stereotools: invalid ${key}`);
                          } else if (key === "enable") enable = value;
                          else {
                            throw new Error(`stereotools: unsupported option ${key}`);
                          }
                        }
                        const balanceGains = (balance: number, balanceMode: number): [number, number] => {
                          let left = 1 - Math.max(0, balance);
                          let right = 1 + Math.min(0, balance);
                          if (balanceMode === 1) {
                            left = 1 - balance;
                            right = 1 + balance;
                          } else if (balanceMode === 2) {
                            if (balance < 0) {
                              right = Math.max(0.5, right);
                              left = 1 / right;
                            } else if (balance > 0) {
                              left = Math.max(0.5, left);
                              right = 1 / left;
                            }
                          }
                          return [left, right];
                        };
                        const [inputLeft, inputRight] = balanceGains(balance.balance_in, balanceModes.bmode_in);
                        const [outputLeftGain, outputRightGain] = balanceGains(balance.balance_out, balanceModes.bmode_out);
                        const width = base < 0 ? base / 2 : base;
                        budget.allocateMemory(stretched[0]!.length * 2 * Float64Array.BYTES_PER_ELEMENT);
                        const left = new Float64Array(stretched[0]!.length);
                        const right = new Float64Array(left.length);
                        const clipScale = 1 / Math.atan(sclevel);
                        // Native FFmpeg rounds the interleaved delay down to an even sample count.
                        const delayFrames = Math.floor(origRate * (Math.abs(delay) / 1000) / 2);
                        budget.allocateMemory(delayFrames * 8);
                        const phaseCos = Math.cos(phase / 180 * Math.PI);
                        const phaseSin = Math.sin(phase / 180 * Math.PI);
                        const midLeft = 1 - Math.max(0, balance.mpan);
                        const midRight = 1 + Math.min(0, balance.mpan);
                        const sideLeft = 1 - Math.max(0, balance.sbal);
                        const sideRight = 1 + Math.min(0, balance.sbal);
                        const delayed = new Float64Array(delayFrames);
                        let delayPosition = 0;
                        let frameEnd = 0;
                        let frameIndex = 0;
                        let enabled = true;
                        for (let i = 0; i < left.length; i++) {
                          if (enable !== undefined && i >= frameEnd) {
                            const packet = t.samples[frameIndex];
                            const timestamp = audioTimestamps?.[frameIndex];
                            const frameLength = timestamp ? timestamp.end - timestamp.start
                              : packet ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024;
                            const pts = timestamp?.pts ?? (packet ? packet.pts * origRate / t.timescale : audioStartSample + i);
                            enabled = Math.abs(parseFilterExpression(enable, "stereotools enable", {
                              n: frameIndex, t: pts / origRate
                            })) >= 0.5;
                            frameEnd = i + frameLength;
                            frameIndex++;
                          }

                          if (++work % 1024 === 0) { await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                          if (!enabled) {
                            left[i] = stretched[0]![i]!;
                            right[i] = stretched[1]![i]!;
                            continue;
                          }
                          let l = stretched[0]![i]! * levels.level_in * inputLeft;
                          let r = stretched[1]![i]! * levels.level_in * inputRight;
                          if (flags.softclip) {
                            l = clipScale * Math.atan(l * sclevel);
                            r = clipScale * Math.atan(r * sclevel);
                          }
                          let outputLeft = l;
                          let outputRight = r;
                          switch (mode) {
                            case 0:
                            case 6: {
                              const mid = (l + r) / 2 * levels.mlev;
                              const side = (mode === 6 ? r - l : l - r) / 2 * levels.slev;
                              outputLeft = mid * midLeft + side * sideLeft;
                              outputRight = mid * midRight - side * sideRight;
                              break;
                            }
                            case 1:
                              outputLeft = (l * sideLeft + r * sideRight) / 2 * levels.mlev;
                              outputRight = (l * sideLeft - r * sideRight) / 2 * levels.slev;
                              break;
                            case 2:
                            case 7:
                            case 8:
                            case 9:
                              outputLeft = l * levels.mlev * midLeft + r * levels.slev * sideLeft;
                              outputRight = l * levels.mlev * midRight - r * levels.slev * sideRight;
                              if (mode === 7) outputRight = outputLeft;
                              if (mode === 8) outputLeft = outputRight;
                              if (mode === 9) [outputLeft, outputRight] = [outputRight, outputLeft];
                              break;
                            case 3: outputRight = l; break;
                            case 4: outputLeft = r; break;
                            case 5: outputLeft = outputRight = (l + r) / 2; break;
                            case 10: outputLeft = outputRight = (l - r) / 2; break;
                          }
                          outputLeft = flags.mutel ? 0 : outputLeft * (flags.phasel ? -1 : 1);
                          outputRight = flags.muter ? 0 : outputRight * (flags.phaser ? -1 : 1);
                          if (delayFrames > 0) {
                            const slot = delayPosition++ % delayFrames;
                            const previous = delayed[slot]!;
                            delayed[slot] = delay < 0 ? outputLeft : outputRight;
                            if (delay < 0) outputLeft = previous;
                            else outputRight = previous;
                          }
                          // Width follows mute, phase inversion and delay, before output rotation/gain.
                          const wideLeft = outputLeft + width * outputLeft - width * outputRight;
                          outputRight = outputRight + width * outputRight - width * outputLeft;
                          outputLeft = wideLeft;
                          left[i] = (outputLeft * phaseCos - outputRight * phaseSin) * outputLeftGain * levels.level_out;
                          right[i] = (outputLeft * phaseSin + outputRight * phaseCos) * outputRightGain * levels.level_out;
                        }
                        stretched = [left, right];
                      } else if (trimmed.startsWith("channelmap=")) {
                        let map: string | undefined;
                        let layout = "";
                        for (const [index, option] of trimmed.slice("channelmap=".length).trimStart().split(":").entries()) {
                          const separator = option.indexOf("=");
                          const key = separator < 0 ? ["map", "channel_layout"][index] : option.slice(0, separator);
                          const value = separator < 0 ? option : option.slice(separator + 1);
                          if (key === "map") map = value;
                          else if (key === "channel_layout") layout = value;
                          else throw new Error(`channelmap: unsupported option ${key}`);
                        }
                        const speakers = Object.keys(audioSpeakerMasks);
                        const channelName = (name: string) => {
                          if (!name.startsWith("USR")) return name;
                          const digits = name.slice(3);
                          if (!digits || [...digits].some(char => char < "0" || char > "9")) return name;
                          const id = Number(digits);
                          return Object.keys(audioSpeakerMasks).find(speaker => audioSpeakerMasks[speaker] === 2 ** id) ?? `USR${id}`;
                        };
                        const inputNames = filteredChannelNames ?? (filteredChannelMask
                          ? speakers.filter(name => Math.floor(filteredChannelMask! / audioSpeakerMasks[name]!) % 2 === 1)
                          : stretched.length === 1 ? ["FC"] : stretched.length === 2 ? ["FL", "FR"] : []);
                        let outputNames: string[] | undefined;
                        if (layout) {
                          const count = parseAudioChannelCount(layout);
                          outputNames = count === undefined ? parseAudioChannelLayout(layout).map(channelName) : Array<string>(count).fill("");
                          if (count === undefined && outputNames.some(name => !speakers.includes(name) &&
                            !(name.startsWith("USR") && name.length > 3 &&
                              [...name.slice(3)].every(char => char >= "0" && char <= "9") && Number(name.slice(3)) <= 2147483647))) {
                            throw new Error("channelmap: unsupported channel layout");
                          }
                        }
                        if (map?.endsWith("|")) map = map.slice(0, -1);
                        const entries = map === undefined && outputNames
                          ? outputNames.map((_, index) => [String(index)])
                          : (map ?? "").split("|").map(value => value.split("-"));
                        const numeric = (value: string) => value.length > 0 && [...value].every(char => char >= "0" && char <= "9");
                        const paired = entries[0]!.length === 2;
                        const numericInput = numeric(entries[0]![0]!);
                        const numericOutput = !paired || numeric(entries[0]![1]!);
                        for (const entry of entries) {
                          if (entry.length !== (paired ? 2 : 1) || numeric(entry[0]!) !== numericInput ||
                              (paired && numeric(entry[1]!) !== numericOutput)) {
                            throw new Error("channelmap: mixed or invalid channel mapping");
                          }
                        }
                        if (!outputNames && paired && !numericOutput) {
                          const destinations = entries.map(entry => entry[1]!);
                          if (destinations.some(name => !speakers.includes(name))) throw new Error("channelmap: invalid output channel");
                          outputNames = speakers.filter(name => destinations.includes(name));
                        }
                        // FFmpeg's default layouts by channel count: mono, stereo, 2.1,
                        // 4.0, 5.0, 5.1, 6.1, and 7.1 (four channels are not quad).
                        const defaultMask = [0, 0x4, 0x3, 0xb, 0x107, 0x37, 0x3f, 0x70f, 0x63f][entries.length] ?? 0;
                        outputNames ??= defaultMask
                          ? speakers.filter(name => Math.floor(defaultMask / audioSpeakerMasks[name]!) % 2 === 1)
                          : Array<string>(entries.length).fill("");
                        if (!outputNames.length || entries.length !== outputNames.length) {
                          throw new Error("channelmap: unsupported or mismatched channel layout");
                        }
                        const selected = new Array<(typeof stretched)[number]>(outputNames.length);
                        for (const [index, entry] of entries.entries()) {
                          if (!entry[0] || (paired && !entry[1])) throw new Error("channelmap: invalid channel name");
                          const input = numericInput ? Number(entry[0]) : inputNames.indexOf(channelName(entry[0]));
                          const output = !paired ? index : numericOutput ? Number(entry[1]) : outputNames.indexOf(channelName(entry[1]!));
                          if (!Number.isSafeInteger(input) || input < 0 || input >= stretched.length) {
                            const unnamed = filteredChannelNames?.every(name => name === "") && speakers.includes(channelName(entry[0]));
                            throw new Error(`channelmap: unavailable input channel ${entry[0]}${unnamed ? " (unnamed layout)" : ""}`);
                          }
                          if (!Number.isSafeInteger(output) || output < 0 || output >= selected.length || selected[output]) {
                            throw new Error("channelmap: invalid or duplicate output channel");
                          }
                          selected[output] = stretched[input]!;
                        }
                        stretched = selected;
                        filteredChannelNames = outputNames;
                        filteredChannelMask = outputNames.every((name, index) => speakers.includes(name) &&
                          (index === 0 || speakers.indexOf(name) > speakers.indexOf(outputNames![index - 1]!)))
                          ? outputNames.reduce((mask, name) => mask + audioSpeakerMasks[name]!, 0) : undefined;
                      } else if (trimmed === "channelsplit" || trimmed.startsWith("channelsplit=")) {
                        const { input, selected } = parseChannelSplit(trimmed);
                        if (selected.length !== 1) throw new Error("channelsplit: simple audio filters require exactly one output");
                        const speakers = ["FL", "FR", "FC", "LFE", "BL", "BR"];
                        const mask = input.reduce((value, speaker) => value | (1 << speakers.indexOf(speaker)), 0);
                        if (mask === 3 && (stretched.length === 1 || stretched.length === 6)) {
                          const mono = stretched.length === 1;
                          if (!mono && filteredChannelMask && filteredChannelMask !== 0x3f && filteredChannelMask !== 0x60f) {
                            throw new Error(`channelsplit: unsupported input channel layout (mask ${filteredChannelMask})`);
                          }
                          const pcm16 = t.codecDescriptions[0]?.codecName === "pcm_s16le";
                          budget.allocateMemory(stretched[0]!.length * 2 * 8);
                          const stereo = [new Float64Array(stretched[0]!.length), new Float64Array(stretched[0]!.length)];
                          for (const [channel, output] of stereo.entries()) {
                            for (let i = 0; i < output.length; i++) {
                              if (++work % 1024 === 0) { await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                              const front = stretched[mono ? 0 : channel]![i]!;
                              const surround = mono ? 0 : stretched[2]![i]! + stretched[channel + 4]![i]!;
                              // Negotiate stereo before splitting, including the s16 mixer's Q15 rounding.
                              output[i] = pcm16
                                ? Math.floor(front * (mono ? 23170 : 13573) + (mono ? 0 : stretched[2]![i]! * 9597 + stretched[channel + 4]![i]! * 9598) + 0.5) / 32768
                                : mono ? front * Math.SQRT1_2 : (front + surround * Math.SQRT1_2) / (1 + Math.SQRT2);
                            }
                          }
                          stretched = stereo;
                          filteredChannelMask = 3;
                          filteredChannelNames = undefined;
                        }
                        if (stretched.length !== input.length || (filteredChannelMask && filteredChannelMask !== mask)) {
                          throw new Error("channelsplit: matching input channel layout required");
                        }
                        stretched = [stretched[input.indexOf(selected[0]!)]!];
                        filteredChannelMask = 1 << speakers.indexOf(selected[0]!);
                        filteredChannelNames = undefined;
                      } else if (["asettb", "asetpts", "aselect"].includes(filterName)) {
                        const timeBase = audioTimeBase ?? 1 / origRate;
                        const samplesPerTick = timeBase * origRate;
                        const toTicks = (pts: number) => Math.sign(pts) * Math.round(Math.abs(pts) / samplesPerTick);
                        const selecting = trimmed === "aselect" || trimmed.startsWith("aselect=");
                        const argument = trimmed.includes("=") ? trimmed.slice(trimmed.indexOf("=") + 1) : selecting ? "1" : filterName === "asettb" ? "intb" : "PTS";
                        let expression = argument.startsWith("expr=") ? argument.slice(5) : argument;
                        if (filterName === "asettb") {
                          expression = "intb";
                          for (const [index, option] of argument.split(":").entries()) {
                            const separator = option.indexOf("=");
                            const key = separator < 0 && index === 0 ? "expr" : option.slice(0, separator);
                            if (key !== "expr" && key !== "tb") throw new Error("asettb: unsupported option");
                            expression = separator < 0 ? option : option.slice(separator + 1);
                          }
                          audioTimeBase = parseFilterExpression(expression, "asettb", { intb: timeBase, sr: origRate, AVTB: 1 / 1000000 });
                          if (audioTimeBase <= 0) throw new Error("asettb: time base must be positive");
                        }
                        if (selecting) {
                          expression = "1";
                          for (const [index, option] of argument.split(":").entries()) {
                            const separator = option.indexOf("=");
                            const key = separator < 0 ? ["expr", "outputs"][index] : option.slice(0, separator);
                            const value = separator < 0 ? option : option.slice(separator + 1);
                            if (key === "expr" || key === "e") expression = value;
                            else if (key === "outputs" || key === "n") {
                              if (parseFilterExpression(value, "aselect", {}) !== 1) {
                                throw new Error("aselect: only one output is supported");
                              }
                            } else throw new Error("aselect: unsupported option");
                          }
                        }
                        if (!audioTimestamps) {
                          audioTimestamps = [];
                          const length = stretched[0]?.length ?? 0;
                          for (let start = 0, n = 0; start < length; n++) {
                            const packet = t.samples[n];
                            const count = packet ? Math.max(1, Math.round(packet.duration * origRate / t.timescale)) : 1024;
                            const end = Math.min(length, start + count);
                            audioTimestamps.push({ start, end, pos: packet?.offset,
                              pts: packet ? packet.pts * origRate / t.timescale : audioStartSample + start });
                            start = end;
                          }
                        }
                        if (filterName === "asettb") {
                          const samplesPerTick = audioTimeBase! * origRate;
                          for (const frame of audioTimestamps) {
                            if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                            frame.pts = Math.sign(frame.pts) * Math.round(Math.abs(frame.pts) / samplesPerTick) * samplesPerTick;
                          }
                          continue;
                        }
                        if (selecting) {
                          const variables = {
                            samples_n: NaN, sample_rate: origRate, consumed_samples_n: NaN,
                            PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2,
                            // Decoded audio is key; video classification and concat metadata are unavailable.
                            key: 1, pict_type: NaN, interlace_type: NaN, concatdec_select: NaN,
                            I: 1, PROGRESSIVE: 0,
                            n: 0, t: NaN, pts: NaN, TB: timeBase, start_pts: NaN, start_t: NaN, pos: NaN,
                            selected_n: 0, prev_pts: NaN, prev_t: NaN,
                            prev_selected_n: NaN, prev_selected_pts: NaN, prev_selected_t: NaN
                          };
                          const registers = new Float64Array(10);
                          if (audioTimestamps.length === 0) parseFilterExpression(expression, "aselect", variables, undefined, registers);
                          const selected: typeof audioTimestamps = [];
                          const ranges: { start: number; end: number }[] = [];
                          let length = 0;
                          for (const [n, frame] of audioTimestamps.entries()) {
                            budget.checkCpu();
                            await yieldTurn(context.signal);
                            context.signal?.throwIfAborted();
                            variables.n = n;
                            variables.samples_n = frame.end - frame.start;
                            variables.pts = toTicks(frame.pts);
                            variables.pos = frame.pos !== undefined && frame.pos >= 0 ? frame.pos : NaN;
                            variables.t = frame.pts / origRate;
                            if (Number.isNaN(variables.start_pts)) {
                              variables.start_pts = variables.pts;
                              variables.start_t = variables.t;
                            }
                            const keep = parseFilterExpression(expression, "aselect", variables, undefined, registers) !== 0;
                            variables.prev_pts = variables.pts;
                            variables.prev_t = variables.t;
                            if (!keep) continue;
                            variables.selected_n++;
                            variables.prev_selected_n = n;
                            variables.prev_selected_pts = variables.pts;
                            variables.prev_selected_t = variables.t;
                            ranges.push(frame);
                            const end = length + frame.end - frame.start;
                            selected.push({ start: length, end, pts: frame.pts, pos: frame.pos });
                            length = end;
                          }
                          budget.allocateMemory(length * stretched.length * 8);
                          const output = stretched.map(() => new Float64Array(length));
                          let offset = 0;
                          for (const frame of ranges) {
                            for (let start = frame.start; start < frame.end; start += 4096) {
                              budget.checkCpu();
                              await yieldTurn(context.signal);
                              context.signal?.throwIfAborted();
                              const end = Math.min(frame.end, start + 4096);
                              for (const [channel, samples] of stretched.entries()) {
                                output[channel]!.set(samples.subarray(start, end), offset + start - frame.start);
                              }
                            }
                            offset += frame.end - frame.start;
                          }
                          stretched = output;
                          audioTimestamps = selected;
                          continue;
                        }
                        const startPts = audioTimestamps[0]?.pts ?? 0;
                        let previousOutputPts = NaN;
                        let previousInputPts = NaN;
                        // Validate even an empty stream; expressions use the current filter time base.
                        if (audioTimestamps.length === 0) parseFilterExpression(expression, "asetpts", {
                          POS: NaN,
                          NAN: NaN, PTS: 0, STARTPTS: 0, STARTT: 0, T: 0, TB: timeBase, SR: origRate, INTERLACED: 0,
                          FR: NaN, FRAME_RATE: NaN,
                          PREV_INPTS: NaN, PREV_INT: NaN,
                          N: 0, NB_CONSUMED_SAMPLES: 0, NB_SAMPLES: 0, S: 0,
                          PREV_OUTPTS: NaN, PREV_OUTT: NaN
                        });
                        for (const frame of audioTimestamps) {
                          if (++work % 1024 === 0) { await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                          const inputPts = frame.pts;
                          frame.pts = Math.trunc(parseFilterExpression(expression, "asetpts", {
                            POS: frame.pos !== undefined && frame.pos >= 0 ? frame.pos : NaN,
                            NAN: NaN, PTS: toTicks(frame.pts), STARTPTS: toTicks(startPts), STARTT: startPts / origRate, T: frame.pts / origRate, TB: timeBase, SR: origRate, INTERLACED: 0,
                            FR: NaN, FRAME_RATE: NaN,
                            PREV_INPTS: toTicks(previousInputPts), PREV_INT: previousInputPts / origRate,
                            N: frame.start, NB_CONSUMED_SAMPLES: frame.start,
                            NB_SAMPLES: frame.end - frame.start, S: frame.end - frame.start,
                            PREV_OUTPTS: toTicks(previousOutputPts), PREV_OUTT: previousOutputPts / origRate
                          })) * samplesPerTick;
                          previousOutputPts = frame.pts;
                          previousInputPts = inputPts;
                        }
                      } else if (trimmed === "atrim" || trimmed.startsWith("atrim=")) {
                        const { duration, startPts, endPts, startSample, endSample } = parseAtrim(trimmed.slice("atrim=".length), origRate, audioTimeBase);
                        const length = stretched[0]?.length ?? 0;
                        const ranges: { start: number; end: number }[] = [];
                        const retained: NonNullable<typeof audioTimestamps> = [];
                        let firstPts: number | undefined;
                        let outputLength = 0;
                        let nextPts = 0;
                        if (!audioTimestamps) {
                          audioTimestamps = [];
                          for (let start = 0, n = 0; start < length; n++) {
                            if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                            const packet = t.samples[n];
                            const count = packet ? Math.max(0, Math.round(packet.duration * origRate / t.timescale)
                              - (packet.skipSamples ?? 0) - (packet.discardPadding ?? 0)) : 1024;
                            if (count === 0) continue;
                            const end = Math.min(length, start + count);
                            const pts = packet ? packet.pts * origRate / t.timescale + (packet.skipSamples ?? 0) : audioStartSample + start;
                            budget.allocateMemory(32);
                            audioTimestamps.push({ start, end, pts, pos: packet?.offset });
                            start = end;
                          }
                        }
                        for (const frame of audioTimestamps) {
                          if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                          const count = frame.end - frame.start;
                          const pts = Number.isNaN(frame.pts) ? nextPts : Math.sign(frame.pts) * Math.round(Math.abs(frame.pts));
                          nextPts = pts + count;
                          // Timestamp bounds apply to every frame; sample bounds count all input samples.
                          let start = Math.min(startPts - pts, startSample - frame.start);
                          if (start === Infinity) start = 0;
                          if (start >= count) continue;
                          firstPts ??= pts + start;
                          let end = Math.max(endPts - pts, endSample - frame.start,
                            duration > 0 ? firstPts + duration - pts : -Infinity);
                          if (end === -Infinity) end = count;
                          // Only a frame wholly past every end bound ends the stream.
                          if (end <= 0) break;
                          start = Math.max(0, start);
                          end = Math.min(count, end);
                          if (end <= start) continue;
                          budget.allocateMemory(48);
                          ranges.push({ start: frame.start + start, end: frame.start + end });
                          const samplesPerTick = (audioTimeBase ?? 1 / origRate) * origRate;
                          retained.push({ start: outputLength, end: outputLength + end - start,
                            pts: frame.pts + Math.round(start / samplesPerTick) * samplesPerTick, pos: frame.pos });
                          outputLength += end - start;
                        }
                        const start = ranges[0]?.start ?? length;
                        const end = ranges.at(-1)?.end ?? length;
                        if (end - start === outputLength) {
                          stretched = stretched.map(channel => channel.subarray(start, end));
                        } else {
                          budget.allocateMemory(outputLength * stretched.length * 8);
                          const output = stretched.map(() => new Float64Array(outputLength));
                          let offset = 0;
                          for (const range of ranges) {
                            for (let start = range.start; start < range.end; start += 4096) {
                              budget.checkCpu();
                              await yieldTurn(context.signal);
                              context.signal?.throwIfAborted();
                              const end = Math.min(range.end, start + 4096);
                              for (const [channel, samples] of stretched.entries()) {
                                output[channel]!.set(samples.subarray(start, end), offset + start - range.start);
                              }
                            }
                            offset += range.end - range.start;
                          }
                          stretched = output;
                        }
                        audioTimestamps = retained;
                        audioStartSample = retained[0]?.pts ?? audioStartSample + start;
                      } else if (trimmed === "areverse") {
                        stretched = await mapWork(stretched, async channel => channel.slice().reverse(), context.signal);
                        if (audioTimestamps) {
                          let start = 0;
                          const firstPts = audioTimestamps[0]?.pts ?? audioStartSample;
                          audioTimestamps.reverse();
                          for (const frame of audioTimestamps) {
                            if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                            const count = frame.end - frame.start;
                            frame.start = start;
                            frame.end = start + count;
                            // Native areverse advances AV_NOPTS_VALUE (INT64_MIN) after the first frame.
                            frame.pts = start === 0 ? firstPts : (Number.isNaN(firstPts) ? -(2 ** 63) : firstPts) + start;
                            start += count;
                          }
                        }
                      } else {
                        throw new Error(`Unsupported audio filter: ${trimmed}`);
                      }
                    }
                  }

                  if (sink) return t;

                  if (index === undefined) {
                    const length = stretched[0]?.length ?? 0;
                    budget.checkSamples(length);
                    budget.checkDuration(length / origRate);
                    const samples: MediaTrack["samples"][number][] = [];
                    for (const frame of audioTimestamps ?? []) {
                      if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                      budget.allocateMemory(96);
                      samples.push({ data: new Uint8Array(0), size: 0, pts: frame.pts, dts: frame.pts, cts: 0,
                        duration: frame.end - frame.start, isKeyframe: true, sampleDescriptionIndex: 1 });
                    }
                    return { ...t, timescale: origRate, duration: length, samples, editList: undefined,
                      codecDescriptions: t.codecDescriptions.map(description => ({ ...description,
                        sampleRate: origRate, channels: stretched.length })),
                      decodedAudio: { ...audio, sampleRate: origRate, channels: stretched.length,
                        channelMask: filteredChannelMask, channelData: stretched } };
                  }

                  if (filter && (outputSs !== undefined || outputTo !== undefined || outputDuration !== undefined)) {
                    const start = outputSs === undefined ? 0 : Math.max(0, Math.round(outputSs * origRate) - audioStartSample);
                    const endSeconds = outputDuration === undefined ? outputTo : (outputSs ?? 0) + outputDuration;
                    const end = endSeconds === undefined ? undefined : Math.max(start, Math.round(endSeconds * origRate) - audioStartSample);
                    if (audioTimestamps) {
                      const seek = Math.round((outputSs ?? 0) * origRate);
                      const duration = outputDuration ?? (outputTo === undefined ? undefined : outputTo - (outputSs ?? 0));
                      const firstPts = Math.max(audioTimestamps[0]?.pts ?? 0, outputSs === undefined ? -Infinity : seek);
                      const endPts = duration === undefined ? Infinity : firstPts + Math.round(duration * origRate);
                      const ranges: { start: number; end: number }[] = [];
                      const frames: typeof audioTimestamps = [];
                      let length = 0;
                      for (const frame of audioTimestamps) {
                        if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                        // Duration trims each frame on its own timeline; overlapping frames can both survive.
                        if (frame.pts >= endPts) break;
                        const from = frame.start + (outputSs === undefined ? 0 : Math.max(0, seek - frame.pts));
                        const to = Math.min(frame.end, frame.start + endPts - frame.pts);
                        if (to <= from) continue;
                        ranges.push({ start: from, end: to });
                        frames.push({ start: length, end: length + to - from, pts: frame.pts + from - frame.start - seek });
                        length += to - from;
                      }
                      budget.allocateMemory(length * stretched.length * 8);
                      const output = stretched.map(() => new Float64Array(length));
                      let offset = 0;
                      for (const range of ranges) {
                        for (let start = range.start; start < range.end; start += 4096) {
                          budget.checkCpu();
                          await yieldTurn(context.signal);
                          context.signal?.throwIfAborted();
                          const end = Math.min(range.end, start + 4096);
                          for (const [channel, samples] of stretched.entries()) {
                            output[channel]!.set(samples.subarray(start, end), offset + start - range.start);
                          }
                        }
                        offset += range.end - range.start;
                      }
                      stretched = output;
                      audioTimestamps = frames;
                    } else {
                      stretched = stretched.map(channel => channel.subarray(start, end));
                    }
                  }

                  const resampleFrameLimit = maxAudioFrames !== undefined && audioRate !== undefined && audioRate !== origRate
                    && resampler === "swr" && !loudnormResampling && audioCodec !== "adpcm_ima_wav" && audioCodec !== "adpcm_ms"
                    ? { count: maxAudioFrames, ends: audioTimestamps?.map(frame => frame.end) ??
                      t.samples.map(sample => (sample.dts + sample.duration - (t.samples[0]?.dts ?? 0)) * origRate / t.timescale) }
                    : undefined;
                  if (maxAudioFrames !== undefined && !resampleFrameLimit) {
                    let inputFrames = maxAudioFrames;
                    if ((audioCodec === "adpcm_ima_wav" || audioCodec === "adpcm_ms") && maxAudioFrames > 0) {
                      const channels = audioChannels === undefined || audioChannels < 0 ? stretched.length : audioChannels;
                      const blockSamples = audioCodec === "adpcm_ms"
                        ? 2 + ((blockSize ?? 1024) - 7 * channels) * 2 / channels
                        : 1 + ((blockSize ?? 1024) - 4 * channels) * 2 / channels;
                      const required = maxAudioFrames * blockSamples * origRate / (audioRate ?? origRate);
                      // Consume complete input frames, then flush the encoder's partial block.
                      let end = 0;
                      inputFrames = 0;
                      while (end < required && end < (stretched[0]?.length ?? 0)) {
                        end = audioTimestamps?.[inputFrames]?.end ?? end +
                          (t.samples[inputFrames] ? t.samples[inputFrames]!.duration * origRate / t.timescale : 1024);
                        inputFrames++;
                      }
                    }
                    const end = audioTimestamps
                      ? inputFrames === 0 ? 0 : audioTimestamps[Math.min(inputFrames, audioTimestamps.length) - 1]?.end ?? 0
                      : Math.round(t.samples.slice(0, inputFrames).reduce((total, sample) => total + sample.duration, 0) * origRate / t.timescale)
                        + Math.max(0, inputFrames - t.samples.length) * 1024;
                    stretched = stretched.map(channel => channel.subarray(0, end));
                    audioTimestamps = audioTimestamps?.slice(0, inputFrames);
                  }

                  const audioEnd = outputDuration ?? (outputTo === undefined ? undefined : outputTo - (outputSs ?? 0));
                  if (audioTimestamps && audioEnd !== undefined) {
                    // FFmpeg stops on a frame's shifted PTS, retaining the entire preceding frame.
                    const cutoff = audioTimestamps.find(frame => frame.pts >= audioEnd * origRate);
                    if (cutoff) stretched = stretched.map(channel => channel.subarray(0, cutoff.start));
                  }

                  if (!segmentAudioPackets && !frameChecksumOutput && !filter && audioRate === undefined && audioChannels === undefined && audioCodec !== "adpcm_ima_wav" && audioCodec !== "adpcm_ms") {
                    return { ...t, duration: (stretched[0]?.length ?? 0) * t.timescale / origRate,
                      samples: [], decodedAudio: { ...audio, channelData: stretched } };
                  }

                  const origCh = stretched.length;
                  const targetRate = audioRate ?? origRate;
                  const targetCh = audioChannels !== undefined && audioChannels < 0 ? origCh : audioChannels ??
                    ((audioCodec === "adpcm_ima_wav" || audioCodec === "adpcm_ms") ? Math.min(origCh, 2) : origCh);
                  // Nine channels have no default speaker layout for automatic rematrixing.
                  if (targetCh === 9 && targetCh !== origCh) {
                    throw new Error("Cannot remix to 9 channels: not enough speaker routing information");
                  }
                  if ((audioCodec === "adpcm_ima_wav" || audioCodec === "adpcm_ms") && targetCh > 2) {
                    throw new Error(`${audioCodec}: unsupported channel count ${targetCh}`);
                  }
                  // FFmpeg guesses 2.1 for three-channel PCM without an explicit layout.
                  const channelMask = filteredChannelMask ?? (origCh === 3 ? 11 : undefined);
                  if (origCh === 2 && channelMask && channelMask !== 3 && channelMask !== 12 &&
                      audioChannels !== undefined && audioChannels > 0) {
                    throw new Error(`Unsupported input channel layout (mask ${channelMask})`);
                  }
                  const centerLfe = origCh === 2 && channelMask === 12;
                  const centerLfeStereo = centerLfe && audioChannels === 2;
                  const surroundUpmix = targetCh === 6 &&
                    (centerLfe || origCh === 3 && (channelMask === 7 || channelMask === 11) || origCh === 4 && channelMask === 0x33);
                  const inputSpeakers = surroundUpmix
                    ? [1, 2, 4, 8, 16, 32].filter(speaker => (channelMask! & speaker) !== 0) : [];
                  const threeChannelDownmix = origCh === 3 && (targetCh === 1 || targetCh === 2) &&
                    (channelMask === 7 || channelMask === 11);
                  const centerToLfe = audioChannels === 3 && origCh === 3 && channelMask === 7;
                  const quadToFour = audioChannels === 4 && origCh === 4 && channelMask === 0x33;
                  const centerDownmix = (threeChannelDownmix || centerToLfe) && channelMask === 7;
                  const quadDownmix = origCh === 4 && channelMask === 0x33 && (targetCh === 1 || targetCh === 2);
                  const surroundExpansion = origCh === 6 && targetCh === 8 &&
                    (channelMask === 0x3f || channelMask === 0x60f);
                  const surroundMono = origCh === 6 && targetCh === 1;
                  const surroundStereo = origCh === 6 && targetCh === 2;
                  const monoStereo = origCh === 1 && (targetCh === 2 || targetCh === 3);
                  const pcm16Output = audioCodec === "pcm_s16le" || audioCodec === undefined &&
                    (outputFormat === "segment" ? segmentPlugin?.id : outPlugin?.id) === "wav";
                  const pcm16MonoStereo = monoStereo && !filter && targetRate === origRate &&
                    t.codecDescriptions[0]?.codecName === "pcm_s16le" && pcm16Output;
                  const pcm16CenterDownmix = centerDownmix && !filter && targetRate === origRate &&
                    t.codecDescriptions[0]?.codecName === "pcm_s16le" && pcm16Output;
                  const pcm16QuadDownmix = quadDownmix && targetCh === 2 && !filter && targetRate === origRate &&
                    t.codecDescriptions[0]?.codecName === "pcm_s16le" && pcm16Output;
                  const pcm16SurroundStereo = surroundStereo && !filter && targetRate === origRate &&
                    t.codecDescriptions[0]?.codecName === "pcm_s16le" && pcm16Output;
                  const sevenOneDownmix = origCh === 8 && channelMask === 0x63f && [1, 2, 6].includes(targetCh);
                  // Use the requested mix gains and renormalize every contributing speaker.
                  const centerMatrix = (matrixMaxval === undefined && mixLevel === undefined && surroundLevel === undefined && lfeLevel === undefined) || !(centerDownmix || surroundMono || surroundStereo ||
                    sevenOneDownmix && targetCh <= 2) ? undefined : Array.from({ length: targetCh }, (_, output) => {
                    const row = Array.from({ length: origCh }, (_, input) => input === 2 ? (mixLevel ?? Math.SQRT1_2)
                      : input === 3 ? (lfeLevel ?? 0) * Math.SQRT1_2 : input < 2 ? targetCh === 1 ? 0.5 : input === output ? 1 : 0
                        : targetCh === 1 ? (surroundLevel ?? Math.SQRT1_2) / 2 : input % 2 === output ? (surroundLevel ?? Math.SQRT1_2) : 0);
                    // Mono coefficients use equal-power front gains before normalization.
                    const scale = matrixMaxval !== undefined && targetCh === 1 ? Math.SQRT2 : 1;
                    const normalization = Math.max(1 / scale, row.reduce((sum, gain) => sum + Math.abs(gain), 0) / (matrixMaxval || 1));
                    return row.map(gain => {
                      const normalized = gain / normalization;
                      // PCM16 rematrixing uses Q15 coefficients, including resampler gain options.
                      return (matrixMaxval !== undefined || surroundLevel !== undefined || lfeLevel !== undefined) && pcm16Output && targetRate === origRate &&
                        t.codecDescriptions[0]?.codecName === "pcm_s16le"
                        ? Math.round(normalized * 32768) / 32768 : normalized;
                    });
                  });
                  const pcm16SevenOne = sevenOneDownmix && targetCh !== 1 && !filter && targetRate === origRate &&
                    t.codecDescriptions[0]?.codecName === "pcm_s16le" && pcm16Output;
                  // Normalize against the loudest row, including the extra surround pair.
                  // The PCM16 stereo mixer distributes Q15 rounding between center and surrounds.
                  const sevenOneMatrix = !sevenOneDownmix ? [] : targetCh === 1
                    ? [[Math.SQRT1_2, Math.SQRT1_2, 1, 0, 0.5, 0.5, 0.5, 0.5].map(gain => gain / (3 + Math.SQRT2))]
                    : targetCh === 2
                    ? [[1, 0, Math.SQRT1_2, 0, Math.SQRT1_2, 0, Math.SQRT1_2, 0],
                       [0, 1, Math.SQRT1_2, 0, 0, Math.SQRT1_2, 0, Math.SQRT1_2]].map(row =>
                        row.map((gain, speaker) => pcm16SevenOne
                          ? gain === 0 ? 0 : speaker < 2 ? 10498 : speaker === 2 ? 7424 : 7423
                          : gain / (1 + 3 * Math.SQRT1_2)))
                    : Array.from({ length: 6 }, (_, output) => Array.from({ length: 8 }, (_, input) =>
                        input === output ? pcm16SevenOne ? 19195 : 1 / (1 + Math.SQRT1_2)
                          : output >= 4 && input === output + 2 ? pcm16SevenOne ? 13573 : Math.SQRT1_2 / (1 + Math.SQRT1_2) : 0));
                  const monoSurround = origCh === 1 && targetCh >= 4 && targetCh <= 8;
                  if (targetCh !== origCh && origCh > 2 && !sevenOneDownmix && !surroundUpmix && !threeChannelDownmix && !quadDownmix && !surroundExpansion &&
                      (!(surroundMono || surroundStereo) || (channelMask && channelMask !== 0x3f && channelMask !== 0x60f))) {
                    throw new Error(`Unsupported audio channel layout conversion: ${origCh} channels (mask ${channelMask ?? 0}) to ${targetCh}`);
                  }

                  // Apply rematrix volume to coefficients before PCM rounding. Negative
                  // values ask swresample to normalize the largest coefficient to -1/volume.
                  const remixMatrix = remixVolume === 0 || remixVolume === 1 ? undefined : Array.from({ length: targetCh }, (_, output) =>
                    Array.from({ length: origCh }, (_, input) => {
                      if (centerMatrix) return centerMatrix[output]![input]!;
                      if (sevenOneDownmix) return sevenOneMatrix[output]![input]! / (pcm16SevenOne ? 32768 : 1);
                      if (surroundMono) return [Math.SQRT1_2, Math.SQRT1_2, 1, 0, 0.5, 0.5][input]! / (2 + Math.SQRT2);
                      if (surroundStereo) return (input === output ? 1 : input === 2 || input === output + 4 ? Math.SQRT1_2 : 0) / (1 + Math.SQRT2);
                      if (centerDownmix) return (input === 2 ? Math.SQRT1_2 : input < 2 ? targetCh === 1 ? 0.5 : input === output ? 1 : 0 : 0) / (1 + Math.SQRT1_2);
                      if (quadDownmix) return (targetCh === 1 ? 0.5 : input % 2 === output ? 1 : 0) * (input >= 2 ? Math.SQRT1_2 : 1) / (1 + Math.SQRT1_2);
                      if (quadToFour) return output < 2 ? input === output ? Math.SQRT1_2 : 0 : output === 3 && input >= 2 ? 0.5 : 0;
                      if (monoStereo || centerLfeStereo) return output < 2 && input === 0 ? Math.SQRT1_2 : 0;
                      if (monoSurround) return output === 2 ? 1 : 0;
                      if (surroundUpmix) return inputSpeakers[input] === 1 << output ? 1 : 0;
                      if (surroundExpansion) return input === (output < 4 ? output : channelMask === 0x60f ? output - 2 : output) &&
                        (output < 4 || (channelMask === 0x60f ? output >= 6 : output < 6)) ? 1 : 0;
                      if (targetCh === 1 && !centerLfe && (origCh === 2 || threeChannelDownmix)) return input < 2 ? 0.5 : 0;
                      return input === output ? 1 : 0;
                    }));
                  if (remixMatrix) {
                    const peak = Math.max(...remixMatrix.flat().map(Math.abs));
                    const gain = remixVolume < 0 ? -1 / (remixVolume * peak) : remixVolume;
                    for (const row of remixMatrix) for (let input = 0; input < row.length; input++) row[input]! *= gain;
                  }

                  // Flushing retains the final sample when the converted duration is fractional.
                  let targetSamples = Math.max(0, Math.ceil((stretched[0]?.length ?? 0) * targetRate / origRate));
                  if (targetRate !== origRate) stretched = resampler === "soxr"
                    ? await resampleSoxr(stretched, origRate, targetRate, budget, context.signal, resampleCutoff)
                    : loudnormResampling
                    ? await resampleLoudnorm(stretched, origRate, targetRate, budget, context.signal)
                    : await resampleAudio(stretched, targetSamples, origRate, targetRate, budget, context.signal, filterType, kaiserBeta, filterSize, resampleCutoff, phaseShift, linearInterp, exactRational, resampleFrameLimit);
                  if (targetRate !== origRate && (resampler === "soxr" || !loudnormResampling)) targetSamples = stretched[0]?.length ?? 0;
                  const newChannelData: (Float32Array | Float64Array)[] = [];
                  const ChannelArray = stretched.some(channel => channel instanceof Float64Array) ? Float64Array : Float32Array;
                  for (let c = 0; c < targetCh; c++) {
                    if (++work % 1024 === 0) { await yieldTurn(context.signal); context.signal?.throwIfAborted(); }

                    const dst = new ChannelArray(targetSamples);
                    // Default 4.0 through 7.1 layouts route mono to front center only.
                    // 7.1 orders back speakers before side speakers; keep the absent pair silent.
                    const expandedChannel = c < 4 ? c : channelMask === 0x60f ? c - 2 : c;
                    const srcCh = surroundExpansion ? (c < 4 || (channelMask === 0x60f ? c >= 6 : c < 6)
                      ? stretched[expandedChannel] : undefined) : (monoStereo && c >= 2) || (centerToLfe && c === 2) || (quadToFour && c === 2) || (monoSurround && c !== 2)
                      ? undefined : stretched[surroundUpmix ? inputSpeakers.indexOf(1 << c) : origCh === 1 || centerLfeStereo ? 0 : c];
                    const rightCh = (origCh === 2 && !centerLfe || threeChannelDownmix) && targetCh === 1 ? stretched[1] : undefined;
                    if (srcCh && srcCh.length > 0) {
                      for (let i = 0; i < targetSamples; i++) {
                        if (++work % 1024 === 0) { await yieldTurn(context.signal); context.signal?.throwIfAborted(); }

                        const srcIdx = Math.min(srcCh.length - 1, i);
                        // FFmpeg's normalized 5.1 mono matrix: FL/FR at sqrt(1/2),
                        // center at 1, surrounds at 1/2, and no LFE contribution.
                        // 3.0 adds center at sqrt(1/2); 2.1 drops LFE entirely.
                        const front = rightCh ? (srcCh[srcIdx]! + rightCh[srcIdx]!) / 2 : srcCh[srcIdx]!;
                        // Quad folds each back speaker into its matching front side.
                        const quadFront = quadDownmix && targetCh === 1
                          ? (stretched[0]![srcIdx]! + stretched[1]![srcIdx]!) / 2 : front;
                        const quadBack = quadDownmix
                          ? targetCh === 1 ? (stretched[2]![srcIdx]! + stretched[3]![srcIdx]!) / 2
                            : stretched[c + 2]![srcIdx]! : 0;
                        const sample = quadToFour
                          ? c < 2 ? front * Math.SQRT1_2 : (stretched[2]![srcIdx]! + stretched[3]![srcIdx]!) / 2
                          : quadDownmix
                          ? (quadFront + quadBack * Math.SQRT1_2) / (1 + Math.SQRT1_2)
                          : centerDownmix
                          ? (front + stretched[2]![srcIdx]! * Math.SQRT1_2) / (1 + Math.SQRT1_2)
                          : surroundMono
                          ? ((stretched[0]![srcIdx]! + stretched[1]![srcIdx]!) * Math.SQRT1_2 +
                              stretched[2]![srcIdx]! + (stretched[4]![srcIdx]! + stretched[5]![srcIdx]!) / 2) / (2 + Math.SQRT2)
                          // Stereo keeps each front/surround on its own side, adds
                          // center equally, and omits LFE. Normalize each row to 1.
                          : surroundStereo
                            ? (srcCh[srcIdx]! + (stretched[2]![srcIdx]! + stretched[c + 4]![srcIdx]!) * Math.SQRT1_2) / (1 + Math.SQRT2)
                            : front;
                        // Mono to stereo (or 2.1) uses equal-power FL/FR gains.
                        // The s16 mixer uses a Q15 coefficient and rounds half upward.
                        const mixed = quadToFour && !filter && targetRate === origRate &&
                          t.codecDescriptions[0]?.codecName === "pcm_s16le" && pcm16Output
                          ? c < 2 ? Math.floor(front * 23170 + 0.5) / 32768
                            : Math.floor((stretched[2]![srcIdx]! + stretched[3]![srcIdx]!) * 16384 + 0.5) / 32768
                          : pcm16QuadDownmix
                          ? Math.floor(quadFront * 19195 + quadBack * 13573 + 0.5) / 32768
                          : pcm16CenterDownmix
                          ? Math.floor(front * (targetCh === 1 ? 19196 : 19195) + stretched[2]![srcIdx]! * 13573 + 0.5) / 32768
                          : pcm16MonoStereo
                          ? Math.floor((sample * 32768 * 23170 + 16384) / 32768) / 32768
                          : pcm16SurroundStereo
                            ? Math.floor(srcCh[srcIdx]! * 13573 +
                                (stretched[2]![srcIdx]! + stretched[c + 4]![srcIdx]!) * 9598 + 0.5) / 32768
                          : sample * (monoStereo || centerLfeStereo ? Math.SQRT1_2 : 1);
                        // FFmpeg 7.0.2 converts non-finite floating samples to silence for PCM16.
                        const sevenOneSample = sevenOneMatrix[c]?.reduce((sum, gain, speaker) =>
                          sum + stretched[speaker]![srcIdx]! * gain, 0);
                        const centerSample = centerMatrix?.[c]?.reduce((sum, gain, speaker) =>
                          sum + stretched[speaker]![srcIdx]! * gain, 0);
                        const remixSample = remixMatrix?.[c]?.reduce((sum, gain, speaker) =>
                          sum + stretched[speaker]![srcIdx]! * gain, 0);
                        const scaled = (remixSample ?? centerSample ?? (sevenOneSample === undefined ? mixed : pcm16SevenOne
                          ? Math.floor(sevenOneSample + 0.5) / 32768 : sevenOneSample)) * volFactor;
                        dst[i] = pcm16Output && !Number.isFinite(scaled) ? 0 : scaled;
                      }
                    }
                    newChannelData.push(dst);
                  }

                  const samples: (typeof t.samples)[number][] = [];
                  if ((segmentAudioPackets || frameChecksumOutput) && audioTimestamps) {
                    const ratio = targetRate / origRate;
                    const cutoff = Math.min((resampleCutoff || 0.97) * ratio, 1);
                    const filterLength = filterSize <= cutoff ? 1 : 2 * Math.ceil(filterSize / 2 / cutoff);
                    // swresample emits one packet per input frame, holding the
                    // right half of its filter until more input arrives or EOF.
                    const delay = targetRate === origRate ? 0 : filterLength / 2;
                    let start = 0;
                    for (const frame of audioTimestamps) {
                      if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(context.signal); context.signal?.throwIfAborted(); }
                      if (delay && frame.end <= filterLength) continue;
                      const end = Math.min(targetSamples, Math.max(0, Math.ceil((frame.end - delay) * ratio)));
                      if (end <= start) continue;
                      budget.allocateMemory(16);
                      segmentAudioPackets?.push({ pts: start, isKeyframe: true });
                      if (frameChecksumOutput) {
                        const pts = Math.round((frame.pts - frame.start) * ratio) + start;
                        budget.allocateMemory(48);
                        samples.push({ dts: pts, pts, cts: 0,
                          duration: end - start, isKeyframe: true, size: 0, sampleDescriptionIndex: 1, data: new Uint8Array(0) });
                      }
                      start = end;
                    }
                    if (start < targetSamples) {
                      budget.allocateMemory(16);
                      segmentAudioPackets?.push({ pts: start, isKeyframe: true });
                      if (frameChecksumOutput) {
                        const last = samples.at(-1);
                        const pts = last ? last.pts + last.duration : 0;
                        budget.allocateMemory(48);
                        samples.push({ dts: pts, pts, cts: 0, duration: targetSamples - start,
                          isKeyframe: true, size: 0, sampleDescriptionIndex: 1, data: new Uint8Array(0) });
                      }
                    }
                  }

                  const nextDescs = t.codecDescriptions.map((d) => ({
                    ...d,
                    sampleRate: targetRate,
                    channels: targetCh
                  }));

                  return {
                    ...t,
                    timescale: targetRate,
                    duration: targetSamples,
                    volume: volFactor,
                    codecDescriptions: nextDescs,
                    samples,
                    decodedAudio: {
                      sampleRate: targetRate,
                      channels: targetCh,
                      channelData: newChannelData,
                      ...(targetCh === origCh && (audioChannels === undefined || audioChannels < 0) ? { channelMask } : {})
                    }
                  };
            }

            if ((audioRate !== undefined || audioChannelOptions.length > 0 || rematrixVolume !== 1 || afFilters.length > 0 || maxAudioFrames !== undefined || (audioCodec === "adpcm_ima_wav" || audioCodec === "adpcm_ms")) && audioCodec !== "copy") {
              workingDoc = { ...workingDoc, tracks: await mapWork(workingDoc.tracks,
                (track, index) => filterAudio(track, undefined, index), context.signal) };
            }

            if (audioSinks.length) {
              workingDoc = { ...workingDoc, tracks: workingDoc.tracks.slice(0, -audioSinks.length) };
            }

            chapterSource ??= loadedDocs.findIndex(doc => doc.chapters?.length);
            if (chapterSource >= loadedDocs.length) {
              if (overwrite && !isStdout(outputTarget) && outputTarget !== "/dev/null" && outputFormat !== "null") {
                await context.fs.writeFile(resolvePath(context.cwd, outputTarget), new Uint8Array(0), { signal: context.signal });
              }
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Invalid chapter input index: ${chapterSource}\n`), context.signal);
              return { exitCode: 234 };
            }
            workingDoc = { ...workingDoc, chapters: chapterSource < 0 ? undefined : outputChapters(loadedDocs[chapterSource]!.chapters, outputSs, outputDuration, outputTo) };
            const sourceMetadata = mapGlobalMetadata(loadedDocs, metadataSources);

            // Apply `-metadata` tags
            const metaTags: Mp4MetadataTags = {
              ...sourceMetadata,
              description: metadata.description ?? sourceMetadata.description,
              compilation: metadata.compilation ?? sourceMetadata.compilation,
              custom: writeBext || useMetadataTags || outPlugin?.id === "aiff" || outPlugin?.id === "mpegts" ? { ...sourceMetadata.custom, ...metadata } : sourceMetadata.custom,
              title: metadata.title ?? sourceMetadata.title,
              artist: metadata.artist ?? sourceMetadata.artist,
              composer: metadata.composer ?? sourceMetadata.composer,
              albumArtist: metadata.album_artist ?? sourceMetadata.albumArtist,
              copyright: metadata.copyright ?? sourceMetadata.copyright,
              album: metadata.album ?? sourceMetadata.album,
              date: metadata.date ?? metadata.year ?? sourceMetadata.date,
              comment: metadata.comment ?? sourceMetadata.comment,
              genre: metadata.genre ?? sourceMetadata.genre,
              trackNumber: metadata.track ?? sourceMetadata.trackNumber,
              discNumber: metadata.disc ?? sourceMetadata.discNumber,
              encoder: (outPlugin?.id === "ffmetadata" || outPlugin?.id === "wav" || outPlugin?.id === "flac") ? (bitexact ? undefined : "Lavf61.7.100") : metadata.encoder ?? sourceMetadata.encoder
            };
            workingDoc = {
              ...workingDoc,
              faststart,
              metadata: metaTags,
              tracks: applyStreamDispositions(applyStreamMetadata(mapStreamMetadata(workingDoc.tracks, loadedDocs, streamMetadataMaps), streamMetadata, metadataSources.at(-1)), streamDispositions, outPlugin?.id, defaultMode)
            };

            if (outPlugin?.id === "mp4" || outPlugin?.id === "mov") {
              workingDoc = { ...workingDoc, tracks: writeTmcd ? authorTimecode(workingDoc.tracks, metadata.timecode) : removeTimecode(workingDoc.tracks) };
              if (useStreamIdsAsTrackIds) {
                const ids = new Map(workingDoc.tracks.map((track, index) => [track.id, streamIds.get(index) ?? 0]));
                workingDoc = { ...workingDoc, tracks: workingDoc.tracks.map((track, index) => ({
                  ...track,
                  id: streamIds.get(index) ?? 0,
                  ...(track.timecodeTrackId === undefined ? {} : { timecodeTrackId: ids.get(track.timecodeTrackId)! })
                })) };
              }
            }

            if ((videoPreset !== undefined || videoQp !== undefined || videoBitrate || crf !== undefined) && videoCodec !== "copy") {
              if (videoCodec !== undefined && videoCodec !== "libx264" && videoCodec !== "h264") throw new Error("Presets and video bitrate require H.264 encoding");
              workingDoc = { ...workingDoc, tracks: await mapWork(workingDoc.tracks, track =>
                encodeH264PresetTrack(track, videoPreset ?? "medium", budget, forceKeyFrames, maxBFrames, videoQp, videoBitrate, zeroLatency, crf), context.signal) };
            }

            let decodeExitCode = demuxExitCode;
            for (const track of workingDoc.tracks) {
              if ((track.type === "subtitle" ? subtitleCodec : audioCodec) === "copy") continue;
              for (const error of track.decodeErrors ?? []) {
                await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${error}\n`), context.signal);
              }
              const errors = track.decodeErrors?.length ?? 0;
              const frames = track.samples.filter(sample => sample.duration > 0).length;
              // FFmpeg 7.0.2 divides integer counters per decoder, truncating partial rates.
              const rate = errors || frames ? Math.floor(errors / (errors + frames)) : 0;
              if (exitOnError && errors) {
                decodeExitCode = 183;
              } else if (rate > maxErrorRate && decodeExitCode !== 183) {
                await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Decode error rate ${rate} exceeds maximum ${maxErrorRate}\n`), context.signal);
                decodeExitCode = 69;
              }
            }

            workingDoc = { ...workingDoc, tracks: filterBitstream(filterBitstream(filterBitstream(workingDoc.tracks, videoBitstreamFilter, budget, "video", workingDoc.timescale), audioBitstreamFilter, budget, "audio", workingDoc.timescale), subtitleBitstreamFilter, budget, "subtitle", workingDoc.timescale) };
            if (autobsf && videoCodec === "copy" && (outPlugin?.id === "mkv" || outPlugin?.id === "webm" || outPlugin?.id === "mp4")) {
              workingDoc = { ...workingDoc, tracks: mergeVp9Superframes(workingDoc.tracks, budget) };
            }

            // Count processed media, not container headers or checksum text.
            workingDoc = applyDisplayAspects(workingDoc, displayAspects);
            workingDoc = applyOutputColors(workingDoc, outputColors);
            workingDoc = shiftTimestamps(workingDoc, outputTimestampOffset, budget);
            workingDoc = avoidNegativeTimestamps(workingDoc, avoidNegativeTs === "auto" && outPlugin?.id === "srt" ? "make_non_negative" : avoidNegativeTs, budget);
            let outputHasFrames = false;
            for (const [streamIndex, track] of workingDoc.tracks.entries()) {
              const hasFrames = track.decodedAudio ? track.decodedAudio.channelData.some(channel => channel.length > 0)
                : track.decodedVideoFrames ? track.decodedVideoFrames.length > 0
                  : track.samples.length > 0;
              outputHasFrames ||= hasFrames;
              if (!hasFrames) emptyOutputStreams.push(`${progressOutputIndex}:${streamIndex}`);
            }
            hasOutputFrames ||= outputHasFrames;
            hasEmptyOutput ||= !outputHasFrames;

            if (progressTarget !== undefined) {
              for (const [streamIndex, track] of workingDoc.tracks.entries()) {
                if (track.type === "video") {
                  progressFrames ??= track.decodedVideoFrames?.length ?? track.samples.length;
                  progressQuality.push(`stream_${progressOutputIndex}_${streamIndex}_q=${videoCodec === "copy" ? "-1.0" : "-0.0"}`);
                }
                if (track.decodedAudio) {
                  progressSeconds = Math.max(progressSeconds,
                    (track.decodedAudio.channelData[0]?.length ?? 0) / track.decodedAudio.sampleRate);
                } else if (track.decodedVideoFrames) {
                  for (const frame of track.decodedVideoFrames) {
                    progressSeconds = Math.max(progressSeconds, frame.ptsSeconds + frame.durationSeconds);
                  }
                } else {
                  for (const sample of track.samples) {
                    progressSeconds = Math.max(progressSeconds, (sample.dts + sample.cts + sample.duration) / track.timescale);
                  }
                }
              }
            }

            if (outputFormat === "tee") {
              let successful = 0;
              let totalBytes = 0;
              for (const slave of parseTee(outputTarget)) {
                try {
                  const plugin = slave.format
                    ? (registry.findById(slave.format) ?? registry.findByFormatName(slave.format))
                    : registry.findByFilename(slave.target);
                  if (!plugin?.canMux) throw new Error(`Unable to find a suitable output format for '${slave.format ?? slave.target}'`);
                  const path = resolvePath(context.cwd, slave.target);
                  if (inputs.some(input => input.format !== "lavfi" && !isStdin(input.path) && resolvePath(context.cwd, input.path) === path)) {
                    throw new Error(`Output ${slave.target} same as input; cannot edit in-place`);
                  }
                  if (!overwrite && !isStdout(slave.target) && slave.target !== "/dev/null") {
                    try {
                      await context.fs.stat(path, { signal: context.signal });
                      throw new Error(`File '${slave.target}' already exists. Exiting.`);
                    } catch (error) {
                      rethrowRuntimeError(context, error);
                      if ((error as { code?: string }).code !== "ENOENT") throw error;
                    }
                  }
                  const doc = { ...workingDoc, tracks: selectTeeTracks(workingDoc.tracks, slave.select) };
                  if (!doc.tracks.length) throw new Error("Tee destination does not contain any stream");
                  validateRawAudioCodec(doc, plugin, audioCodec);
                  validateStreamCopy(doc, plugin.id, { video: videoCodec, audio: audioCodec, subtitle: subtitleCodec });
                  validateSubtitleEncoder(subtitleCodec, doc, plugin.id);
                  const bytes = serializeLimitedWav(doc, plugin, {
                    format: slave.format, seekable: !isStdout(slave.target),
                    audioCodec, videoCodec, maxBFrames, audioBitrate, blockSize, trellis, sampleFormat, metadata: metaTags, budget
                  }, undefined);
                  totalBytes += bytes.byteLength;
                  budget.checkOutputBytes(totalBytes);
                  if (isStdout(slave.target)) await writeBytes(context.stdout, bytes, context.signal);
                  else if (slave.target !== "/dev/null") await writeFileOutput(context, bytes,
                    data => context.fs.writeFile(path, data, { signal: context.signal }));
                  successful++;
                } catch (error) {
                  rethrowRuntimeError(context, error);
                  if (!slave.ignore) throw error;
                  await writeBytes(context.stderr, encodeUtf8(`ffmpeg: tee destination '${slave.target}' failed: ${(error as Error).message}\n`), context.signal);
                }
              }
              if (!successful) throw new Error("All tee destinations failed");
              if (firstOutput) progressSize = totalBytes;
              options.onMetrics?.(budget.getStats());
              return { exitCode: decodeExitCode };
            }

            // Null muxer (`-f null -`)
            if (outputFormat === "null") {
              options.onMetrics?.(budget.getStats());
              return { exitCode: decodeExitCode };
            }

            if (outputFormat === "segment") {
              if (segmentTimes === undefined && segmentFrames === undefined && minSegmentDuration > segmentTime) {
                throw new Error("min_seg_duration cannot be greater than segment_time");
              }
              const track = workingDoc.tracks.find(track => track.type === "video") ?? workingDoc.tracks[0];
              if (!track || !segmentPlugin?.canMux || !(segmentPlugin.id === "mp4" ||
                  ((audioSegment || (["mkv", "aac"].includes(segmentPlugin.id) && audioCodec === "copy")) &&
                    workingDoc.tracks.length === 1 && track.type === "audio"))) {
                throw new Error("segment output requires MP4 format or a single audio track with WAV/raw audio format or Matroska/ADTS stream copy");
              }
              if (formatImageSequence(outputTarget, 0) === undefined) {
                throw new Error("segment output requires a numbered filename pattern");
              }
              if (segmentHeaderFilename !== undefined && segmentPlugin.id !== "wav") {
                throw new Error("segment_header_filename requires WAV segment output");
              }
              validateRawAudioCodec(workingDoc, segmentPlugin, audioCodec);
              validateStreamCopy(workingDoc, segmentPlugin.id, { audio: audioCodec, video: videoCodec });
              if (!writeHeaderTrailer && !audioSegment) {
                throw new Error("write_header_trailer 0 requires WAV or raw audio segments");
              }
              // Copied packets retain media timestamps; segment cuts use presentation time.
              let audioOffset = 0;
              if (audioSegment && audioCodec === "copy") {
                for (const edit of track.editList ?? []) {
                  if (edit.mediaTime < 0) audioOffset -= Math.round(edit.segmentDuration * track.timescale / workingDoc.timescale);
                  else { audioOffset += edit.mediaTime; break; }
                }
              }
              const boundaries = [0];
              for (const [frame, packet] of (segmentAudioPackets ?? track.samples).entries()) {
                budget.checkCpu();
                const seconds = (packet.pts - audioOffset) / track.timescale;
                while (true) {
                  budget.checkCpu();
                  const reached = segmentFrames === undefined
                    ? segmentTimes === undefined
                      ? seconds >= boundaries.length * segmentTime - segmentTimeDelta &&
                        Math.round((seconds - boundaries[boundaries.length - 1]!) * 1_000_000) >= Math.round(minSegmentDuration * 1_000_000)
                      : seconds >= (segmentTimes[boundaries.length - 1] ?? Infinity) - segmentTimeDelta
                    : frame >= (segmentFrames[boundaries.length - 1] ?? Infinity);
                  if (!reached || (!writeEmptySegments && seconds <= boundaries[boundaries.length - 1]!) ||
                      (track.type === "video" && !packet.isKeyframe)) break;
                  boundaries.push(seconds);
                  if (!writeEmptySegments || (segmentTime === 0 && segmentTimes === undefined && segmentFrames === undefined)) break;
                }
              }
              const lastPacket = track.samples.at(-1);
              boundaries.push(segmentPlugin.id === "wav" ||
                (workingDoc.tracks.length === 1 && track.type === "audio" && audioCodec === "copy")
                ? lastPacket ? (lastPacket.pts + lastPacket.duration - audioOffset) / track.timescale : track.duration / track.timescale
                : workingDoc.durationSeconds);
              const paths = boundaries.slice(1).map((_, index) =>
                resolvePath(context.cwd, formatImageSequence(outputTarget,
                  segmentWrap ? (segmentStartNumber + index) % segmentWrap : segmentStartNumber + index)!));
              const listPath = segmentList === undefined ? undefined : resolvePath(context.cwd, segmentList);
              if (listPath !== undefined && paths.includes(listPath)) throw new Error("Segment output filenames collide");
              const headerPath = segmentHeaderFilename === undefined ? undefined : resolvePath(context.cwd, segmentHeaderFilename);
              if (headerPath !== undefined && (paths.includes(headerPath) || listPath === headerPath)) {
                throw new Error("Segment output filenames collide");
              }
              const destinations = new Set(listPath === undefined ? paths : [...paths, listPath]);
              if (headerPath !== undefined) destinations.add(headerPath);
              for (const path of destinations) {
                if (inputs.some(input => input.format !== "lavfi" && resolvePath(context.cwd, input.path) === path)) {
                  throw new Error(`Output ${path} is also an input; cannot edit existing files in-place`);
                }
                if (!overwrite) {
                  let exists = false;
                  try {
                    await context.fs.stat(path, { signal: context.signal });
                    exists = true;
                  } catch (error) {
                    rethrowRuntimeError(context, error);
                    if ((error as { code?: string }).code !== "ENOENT") throw error;
                  }
                  if (exists) throw new Error(`File '${path}' already exists. Exiting.`);
                }
              }
              const listType = segmentListType ?? (segmentList?.toLowerCase().endsWith(".m3u8")
                ? "m3u8" : segmentList?.toLowerCase().endsWith(".ffconcat")
                ? "ffconcat" : [".csv", ".ext"].some(extension =>
                  segmentList?.toLowerCase().endsWith(extension)) ? "csv" : "flat");
              if (listPath !== undefined && listType === "csv") {
                await context.fs.writeFile(listPath, new Uint8Array(0), { signal: context.signal });
              }
              const list: string[] = [];
              for (let index = 0; index < paths.length; index++) {
                await yieldTurn(context.signal);
                context.signal.throwIfAborted();
                const start = boundaries[index]!;
                const end = boundaries[index + 1]!;
                const segment = audioSegment && audioCodec !== "copy"
                  ? sliceMp4(workingDoc, { startSeconds: start, endSeconds: end, budget })
                  : { ...workingDoc, tracks: workingDoc.tracks.map(track => ({
                    ...track,
                    duration: Math.round(end * track.timescale),
                    editList: undefined,
                    samples: track.samples.filter(sample =>
                      (index === 0 || (sample.dts - audioOffset) / track.timescale >= start) &&
                      (index === paths.length - 1 || (sample.dts - audioOffset) / track.timescale < end))
                  })) };
                let bytes = segmentPlugin.serialize(!audioSegment
                  ? shiftTimestamps(segment, initialOffset - (resetTimestamps ? start : 0), budget) : segment, { patPmtAtFrames: (mpegtsFlags & 16) !== 0, patPeriod, writeHeader: headerPath !== undefined || (writeHeader && (segmentPlugin.id !== "wav" || writeHeaderTrailer && (individualHeaderTrailer || index === 0))), writeBext, writeCrc32, muxRate, rf64, writePeak, peakBlockSize, peakFormat, peakPpv, audioCodec, audioBitrate, compressionLevel, blockSize, trellis, frameSize, channelMode, lpcType, lpcPasses, lpcCoeffPrecision, minPartitionOrder, maxPartitionOrder, exactRiceParameters, minPredictionOrder, maxPredictionOrder, predictionOrderMethod, multiDimQuant, sampleFormat, pageDuration, serialOffset, mpegtsServiceId, metadataHeaderPadding, reserveIndexSpace, cuesToFront, clusterTimeLimit, budget, limits: options.limits });
                if (headerPath !== undefined) {
                  // A separate WAV header is nonseekable: sizes stay unknown and
                  // media files contain data only, without RIFF padding or trailers.
                  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                  const chunks = [bytes.subarray(0, 12)];
                  let data: Uint8Array | undefined;
                  let dataSize: number | undefined;
                  for (let offset = 12; offset + 8 <= bytes.length;) {
                    budget.checkCpu();
                    const id = decodeUtf8(bytes.subarray(offset, offset + 4));
                    const size = view.getUint32(offset + 4, true);
                    if (id === "data") {
                      data = bytes.subarray(offset + 8, offset + 8 + (dataSize ?? size));
                      chunks.push(bytes.subarray(offset, offset + 8));
                      break;
                    }
                    const end = offset + 8 + size + (size & 1);
                    if (id === "ds64") dataSize = Number(view.getBigUint64(offset + 16, true));
                    if (id !== "fact") {
                      const chunk = bytes.subarray(offset, end);
                      if (id === "ds64") chunk.fill(0, 8);
                      chunks.push(chunk);
                    }
                    offset = end;
                  }
                  if (!data) throw new Error("WAV segment is missing its data chunk");
                  if (index === 0) {
                    const header = concatBytes(chunks);
                    const headerView = new DataView(header.buffer, header.byteOffset, header.byteLength);
                    headerView.setUint32(4, 0xffffffff, true);
                    headerView.setUint32(header.byteLength - 4, 0xffffffff, true);
                    budget.checkOutputBytes(header.byteLength);
                    await writeFileOutput(context, header, data => context.fs.writeFile(headerPath, data, { signal: context.signal }));
                  }
                  bytes = data;
                }
                budget.checkOutputBytes(bytes.byteLength);
                const path = paths[index]!;
                await writeFileOutput(context, bytes, data => context.fs.writeFile(path, data, { signal: context.signal }));
                if (segmentListSize > 0 && index < paths.length - segmentListSize) continue;
                const name = segmentListEntryPrefix + path.slice(path.lastIndexOf("/") + 1);
                if (listType === "m3u8") {
                  list.push(`#EXTINF:${(end - start).toFixed(6)},\n${name}\n`);
                } else if (listType === "flat") {
                  list.push(`${name}\n`);
                } else if (listType === "ffconcat") {
                  const escapedName = Array.from(name, char => "\\' \t\n\r".includes(char) ? `\\${char}` : char).join("");
                  list.push(`file ${escapedName}\n`);
                } else {
                  const csvName = [",", '"', "\n", "\r"].some(char => name.includes(char))
                    ? '"' + name.replaceAll('"', '""') + '"' : name;
                  list.push(`${csvName},${start.toFixed(6)},${end.toFixed(6)}\n`);
                }
              }
              if (listPath !== undefined) {
                if (listType === "m3u8") {
                  const first = paths.length - list.length;
                  const targetDuration = Math.ceil(list.reduce((longest, _, index) =>
                    Math.max(longest, boundaries[first + index + 1]! - boundaries[first + index]!), 0));
                  list.unshift(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-MEDIA-SEQUENCE:${first}\n#EXT-X-ALLOW-CACHE:YES\n#EXT-X-TARGETDURATION:${targetDuration}\n`);
                  list.push("#EXT-X-ENDLIST\n");
                }
                const bytes = encodeUtf8((listType === "ffconcat" ? "ffconcat version 1.0\n" : "") + list.join(""));
                budget.checkOutputBytes(bytes.byteLength);
                await writeFileOutput(context, bytes, data => context.fs.writeFile(listPath, data, { signal: context.signal }));
              }
              options.onMetrics?.(budget.getStats());
              return { exitCode: decodeExitCode };
            }

            if (outputFormat === "dash" || outputTarget.toLowerCase().endsWith(".mpd")) {
              if (!registry.findByFormatName("dash")?.canMux) throw new Error("DASH AST is not registered");
              const outResolved = resolvePath(context.cwd, outputTarget);
              const outDir = outResolved.slice(0, outResolved.lastIndexOf("/")) || "/";
              const { resources, publications } = serializeDashDocument(workingDoc, { targetLatency: dashTargetLatency, writePrft: dashWritePrft, utcTimingUrl: dashUtcTimingUrl, mpdProfile: dashMpdProfile, hlsPlaylist: dashHlsPlaylist, adaptationSets: dashAdaptationSets, singleFile: dashSingleFile, singleFileName: outResolved.slice(outResolved.lastIndexOf("/") + 1, outResolved.lastIndexOf(".") > outResolved.lastIndexOf("/") ? outResolved.lastIndexOf(".") : undefined) + "-stream$RepresentationID$.$ext$", minPlaybackRate: dashMinPlaybackRate, maxPlaybackRate: dashMaxPlaybackRate, segmentDuration: dashSegmentDuration, segmentType: dashSegmentType, fragmentType: dashFragmentType, fragmentDuration, streaming: dashStreaming, lowLatency: dashLowLatency, windowSize: dashWindowSize, useTemplate: dashUseTemplate, useTimeline: dashUseTimeline, initSegmentName: dashInitSegmentName, mediaSegmentName: dashMediaSegmentName, limits: options.limits, budget });
              await context.fs.mkdir(outDir, { recursive: true, signal: context.signal });
              for (const publication of publications()) {
                for (const [uri, bytes] of publication.resources) {
                  await writeFileOutput(context, bytes, data => context.fs.writeFile(resolvePath(outDir, uri), data, { signal: context.signal }));
                }
                await writeFileOutput(context, publication.manifest, data => context.fs.writeFile(outResolved, data, { signal: context.signal }));
              }
              if (dashRemoveAtExit) {
                for (const uri of resources.keys()) {
                  await context.fs.rm(resolvePath(outDir, uri), { signal: context.signal });
                }
                await context.fs.rm(outResolved, { signal: context.signal });
              }
              options.onMetrics?.(budget.getStats());
              return { exitCode: decodeExitCode };
            }

            // Handle HLS (.m3u8 / -f hls) multi-segment muxing
            if (outputFormat === "hls" || /\.m3u8?$/i.test(outputTarget)) {
              const outResolved = resolvePath(context.cwd, outputTarget);
              const outDir = outResolved.includes("/")
                ? outResolved.slice(0, outResolved.lastIndexOf("/")) || "/"
                : "/";
              if (hlsMasterName) {
                const masterPath = resolvePath(outDir, hlsMasterName);
                if (masterPath === outResolved) throw new Error("HLS master and media playlists must have different filenames");
                if (!overwrite) {
                  try {
                    await context.fs.stat(masterPath, { signal: context.signal });
                    throw new Error(`File '${masterPath}' already exists. Exiting.`);
                  } catch (error) {
                    rethrowRuntimeError(context, error);
                    if ((error as { code?: string }).code !== "ENOENT") throw error;
                  }
                }
              }
              const byteRanges = hlsSingleFile || hlsSegmentSize > 0;
              const programDateTime = Date.now();
              const previous: { uri: string; duration: number; discontinuity: boolean; programDateTime: string | undefined }[] = [];
              let sequence = outputStartNumber ?? 0;
              if (hlsStartNumberSource === "epoch") sequence = Math.floor(programDateTime / 1000);
              else if (hlsStartNumberSource === "epoch_us") sequence = programDateTime * 1000;
              else if (hlsStartNumberSource === "datetime") {
                const date = new Date(programDateTime);
                sequence = Number([date.getFullYear(), date.getMonth() + 1, date.getDate(),
                  date.getHours(), date.getMinutes(), date.getSeconds()]
                  .map(value => String(value).padStart(2, "0")).join(""));
              }
              if (hlsAppendList) {
                if (byteRanges) throw new Error("HLS append_list requires separate segment files");
                let playlist: Uint8Array | undefined;
                try {
                  playlist = await readInput(outResolved);
                } catch (error) {
                  rethrowRuntimeError(context, error);
                  if ((error as { code?: string }).code !== "ENOENT") throw error;
                }
                if (playlist) {
                  const lines = new TextDecoder().decode(playlist).split("\n").map(line => line.trim());
                  if (lines[0] !== "#EXTM3U") throw new Error("Invalid HLS playlist for append_list");
                  let duration: number | undefined;
                  let discontinuity = false;
                  let previousProgramDateTime: string | undefined;
                  for (const line of lines) {
                    budget.checkCpu();
                    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
                      const value = Number(line.slice("#EXT-X-MEDIA-SEQUENCE:".length));
                      if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid HLS media sequence");
                      sequence = Math.max(sequence, value);
                    } else if (line.startsWith("#EXTINF:")) {
                      duration = Number(line.slice(8).split(",")[0]);
                      if (!Number.isFinite(duration) || duration < 0) throw new Error("Invalid HLS segment duration");
                    } else if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) {
                      previousProgramDateTime = line;
                    } else if (line === "#EXT-X-DISCONTINUITY") discontinuity = true;
                    else if (line.startsWith("#EXT-X-BYTERANGE:") || line.startsWith("#EXT-X-KEY:")) {
                      throw new Error("HLS append_list does not support byte ranges or encryption");
                    } else if (line && !line.startsWith("#")) {
                      if (duration === undefined) throw new Error("Missing HLS segment duration");
                      previous.push({ uri: line, duration, discontinuity, programDateTime: previousProgramDateTime });
                      previousProgramDateTime = undefined;
                      duration = undefined;
                      discontinuity = false;
                    }
                  }
                }
              }
              const nextSequence = sequence + previous.length;
              const isFmp4 = hlsSegmentType === "fmp4";
              const segExt = isFmp4 ? "m4s" : "ts";
              const outName = outResolved.slice(outResolved.lastIndexOf("/") + 1);
              const segPattern = hlsSegmentFilename ?? `${outName.includes(".") ? outName.slice(0, outName.lastIndexOf(".")) : outName}${hlsSingleFile ? "" : strftime ? "-%s" : "%d"}.${segExt}`;
              if (hlsSecondLevelSegmentIndex && !strftime) {
                throw new Error("HLS second_level_segment_index requires strftime");
              }
              const segmentTimeZone = strftime && !hlsSingleFile ? new TimeZone(context.env.TZ ?? "UTC") : undefined;
              const segmentFileName = (number: number): string => {
                if (hlsSingleFile) return segPattern;
                const pattern = segmentTimeZone
                  ? formatDate(segPattern, millisecondsInstant(Date.now()), segmentTimeZone, {
                    maxOutputBytes: 1024, maxFormatWidth: 1023,
                    maxArguments: Infinity, maxArgumentBytes: Infinity, maxEnvironmentEntries: Infinity
                  }).slice(0, -1)
                  : segPattern;
                // HLS keeps literal percent pairs; image2 unescapes them.
                const filename = strftime && !hlsSecondLevelSegmentIndex ? pattern : formatImageSequence(pattern, number, true, true);
                if (!filename) throw new Error(`Invalid segment filename template '${segPattern}'`);
                return filename;
              };
              segmentFileName(nextSequence);
              const segPlugin = registry.findByFormatName(isFmp4 ? "mp4" : "mpegts");
              if (!segPlugin) {
                throw new Error(`HLS segment format AST (${isFmp4 ? "mp4" : "mpegts"}) is not registered`);
              }
              const vTrk = workingDoc.tracks.find((t) => t.type === "video");
              const referenceTrack = vTrk ?? workingDoc.tracks.find(track => track.type === "audio");
              const lastAudioSample = !vTrk ? referenceTrack?.samples.at(-1) : undefined;
              const totalSec = Math.max(
                0.1,
                lastAudioSample ? (lastAudioSample.dts + lastAudioSample.duration) / referenceTrack!.timescale
                  : vTrk ? vTrk.duration / Math.max(1, vTrk.timescale) : (workingDoc.durationSeconds || 1)
              );
              const initialDuration = hlsInitTime > 0 && hlsListSize > 0 && !hlsAppendList ? hlsInitTime : hlsTime;
              const boundaries = [0];
              const nextBoundary = () => {
                const completed = boundaries.length - 1;
                // Native HLS changes its cumulative cut schedule once the first window slides.
                return initialDuration !== hlsTime && !hlsPlaylistType && completed > hlsListSize
                  ? hlsListSize * initialDuration + (completed - hlsListSize) * hlsTime
                  : boundaries.length * initialDuration;
              };
              if (referenceTrack?.samples.length) {
                for (const sample of referenceTrack.samples) {
                  const seconds = sample.dts / referenceTrack.timescale;
                  if ((!vTrk || hlsSplitByTime || sample.isKeyframe) && seconds > boundaries.at(-1)! && seconds >= nextBoundary() - 1e-6 && seconds < totalSec) {
                    boundaries.push(seconds);
                  }
                }
              } else {
                for (let seconds = nextBoundary(); seconds < totalSec - 1e-6; seconds = Math.max(seconds + 0.2, nextBoundary())) boundaries.push(seconds);
              }
              boundaries.push(totalSec);
              if (hlsPlaylistType) hlsListSize = 0;
              const firstEntry = hlsListSize === 0 ? 0 : Math.max(0, previous.length + boundaries.length - 1 - hlsListSize);
              const firstSegment = Math.max(0, firstEntry - previous.length);
              let targetDuration = 0;
              for (let i = firstSegment + 1; i < boundaries.length; i++) targetDuration = Math.max(targetDuration, boundaries[i]! - boundaries[i - 1]!);
              for (const entry of previous.slice(firstEntry)) targetDuration = Math.max(targetDuration, entry.duration);
              const independentSegments = hlsIndependentSegments && !hlsSplitByTime && !!vTrk && workingDoc.tracks
                .filter(track => track.type === "video")
                .every(track => boundaries.slice(firstSegment, -1).every((start, index) => {
                  const first = track.samples.find(sample => sample.dts >= start * track.timescale);
                  return first?.isKeyframe && first.dts < boundaries[firstSegment + index + 1]! * track.timescale;
                }));
              const playlistLines: string[] = [
                "#EXTM3U",
                isFmp4 ? "#EXT-X-VERSION:7" : independentSegments ? "#EXT-X-VERSION:6" : byteRanges || hlsIframesOnly ? "#EXT-X-VERSION:4" : hlsRoundDurations ? "#EXT-X-VERSION:2" : "#EXT-X-VERSION:3",
                ...(hlsAllowCache === 0 ? ["#EXT-X-ALLOW-CACHE:NO"] : hlsAllowCache === 1 ? ["#EXT-X-ALLOW-CACHE:YES"] : []),
                `#EXT-X-TARGETDURATION:${Math.round(targetDuration)}`,
                `#EXT-X-MEDIA-SEQUENCE:${hlsSingleFile ? 0 : sequence + firstEntry}`
              ];

              if (hlsPlaylistType) playlistLines.push(`#EXT-X-PLAYLIST-TYPE:${hlsPlaylistType.toUpperCase()}`);
              if (hlsIframesOnly) playlistLines.push("#EXT-X-I-FRAMES-ONLY");
              if (independentSegments) playlistLines.push("#EXT-X-INDEPENDENT-SEGMENTS");
              if (isFmp4 && !hlsSingleFile) playlistLines.push(`#EXT-X-MAP:URI="${hlsFmp4InitFilename}"`);

              for (const entry of previous.slice(firstEntry)) {
                if (entry.discontinuity) playlistLines.push("#EXT-X-DISCONTINUITY");
                playlistLines.push(`#EXTINF:${hlsRoundDurations ? Math.round(entry.duration) : entry.duration.toFixed(6)},`);
                if (hlsProgramDateTime && entry.programDateTime) playlistLines.push(entry.programDateTime);
                playlistLines.push(entry.uri);
              }

              const singleFileChunks: Uint8Array[] = [];
              let singleFileSize = 0;
              let singleFilePath = "";
              let mediaFileNumber = nextSequence;
              const retainedSegments = previous.map(entry => ({ path: resolvePath(outDir, entry.uri), duration: entry.duration }));
              const mediaOffsets = workingDoc.tracks.map(track => {
                let offset = 0;
                for (const edit of track.editList ?? []) {
                  if (edit.mediaTime < 0) offset -= edit.segmentDuration / workingDoc.timescale;
                  else { offset += edit.mediaTime / track.timescale; break; }
                }
                return offset;
              });
              const referenceOffset = mediaOffsets[vTrk ? workingDoc.tracks.indexOf(vTrk) : 0] ?? 0;
              const timestampShift = Math.max(0, ...workingDoc.tracks.map((track, index) =>
                mediaOffsets[index]! - (track.samples[0]?.dts ?? 0) / track.timescale));
              for (let sIdx = 0; sIdx < boundaries.length - 1; sIdx++) {
                const st = boundaries[sIdx]!;
                const en = boundaries[sIdx + 1]!;
                const actualDur = vTrk ? Math.max(0.04, en - st) : en - st;
                // Compare decode times on the reference track's timeline, retaining priming and tail packets.
                const segmentDoc = {
                  ...workingDoc,
                  tracks: workingDoc.tracks.map((track, index) => {
                    const offset = mediaOffsets[index]! - referenceOffset;
                    // fMP4 carries priming as media; shift every stream together to avoid negative decode times.
                    const shift = isFmp4 ? Math.round((timestampShift - mediaOffsets[index]!) * track.timescale) : 0;
                    return {
                      ...track,
                      editList: isFmp4 ? undefined : track.editList,
                      samples: track.samples.filter(sample =>
                        (sIdx === 0 || sample.dts >= (st + offset) * track.timescale) &&
                        (sIdx === boundaries.length - 2 || sample.dts < (en + offset) * track.timescale))
                        .map(sample => shift ? { ...sample, dts: sample.dts + shift, pts: sample.pts + shift } : sample)
                    };
                  })
                };
                let segBytes = segPlugin.serialize(segmentDoc, {
                  patPmtAtFrames: (mpegtsFlags & 16) !== 0, patPeriod,
                  muxRate,
                  pcrPeriod,
                  fragmented: isFmp4,
                  // HLS keeps the segment timeline without transport mux delay.
                  muxDelay: 0,
                  skipTrailer: true,
                  limits: options.limits,
                  budget
                });

                const formattedSeg = segmentFileName(byteRanges ? mediaFileNumber : sIdx + nextSequence);
                const fullSegPath = resolvePath(hlsSegmentFilename === undefined ? outDir : context.cwd, formattedSeg);
                const relSegName = fullSegPath.slice(fullSegPath.lastIndexOf("/") + 1);

                if (isFmp4) {
                  const moof = parseMp4Boxes(segBytes, 0, 0, budget).find(box => box.type === "moof");
                  if (!moof) throw new Error("HLS fMP4 output requires fragmented MP4 samples");
                  if (sIdx === 0) {
                    const init = segBytes.subarray(0, moof.offset);
                    if (hlsSingleFile) {
                      singleFileChunks.push(init);
                      singleFileSize = init.byteLength;
                      playlistLines.push(`#EXT-X-MAP:URI="${relSegName}",BYTERANGE="${singleFileSize}@0"`);
                    } else {
                      await context.fs.mkdir(outDir, { recursive: true, signal: context.signal });
                      await writeFileOutput(context, init, data =>
                        context.fs.writeFile(resolvePath(outDir, hlsFmp4InitFilename), data, { signal: context.signal }));
                    }
                  }
                  segBytes = segBytes.subarray(moof.offset);
                }

                if (byteRanges) {
                  budget.checkOutputBytes(singleFileSize + segBytes.byteLength);
                  singleFilePath = fullSegPath;
                  singleFileChunks.push(segBytes);
                } else {
                  budget.checkOutputBytes(segBytes.byteLength);
                  await context.fs.mkdir(fullSegPath.slice(0, fullSegPath.lastIndexOf("/")) || "/", { recursive: true, signal: context.signal });
                  const destination = hlsTempFile ? `${fullSegPath}.tmp` : fullSegPath;
                  await writeFileOutput(context, segBytes, data => context.fs.writeFile(destination, data, { signal: context.signal }));
                  if (destination !== fullSegPath) await context.fs.rename(destination, fullSegPath, { signal: context.signal });
                }
                if (sIdx >= firstSegment) {
                  if ((hlsDiscontStart || hlsAppendList) && sIdx === 0) playlistLines.push("#EXT-X-DISCONTINUITY");
                  playlistLines.push(`#EXTINF:${hlsRoundDurations ? Math.round(actualDur) : actualDur.toFixed(6)},`);
                  if (byteRanges) playlistLines.push(`#EXT-X-BYTERANGE:${segBytes.byteLength}@${singleFileSize}`);
                  if (hlsProgramDateTime) playlistLines.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(programDateTime + st * 1000).toISOString()}`);
                  playlistLines.push(hlsBaseUrl + relSegName);
                }
                if (byteRanges) singleFileSize += segBytes.byteLength;
                if (byteRanges && (sIdx === boundaries.length - 2 || (!hlsSingleFile && singleFileSize >= hlsSegmentSize))) {
                  if (!overwrite) {
                    try {
                      await context.fs.stat(singleFilePath, { signal: context.signal });
                      throw new Error(`File '${singleFilePath}' already exists. Exiting.`);
                    } catch (error) {
                      rethrowRuntimeError(context, error);
                      if ((error as { code?: string }).code !== "ENOENT") throw error;
                    }
                  }
                  const bytes = concatBytes(singleFileChunks);
                  await context.fs.mkdir(singleFilePath.slice(0, singleFilePath.lastIndexOf("/")) || "/", { recursive: true, signal: context.signal });
                  const destination = hlsTempFile && !hlsSingleFile ? `${singleFilePath}.tmp` : singleFilePath;
                  await writeFileOutput(context, bytes, data => context.fs.writeFile(destination, data, { signal: context.signal }));
                  if (destination !== singleFilePath) await context.fs.rename(destination, singleFilePath, { signal: context.signal });
                  singleFileChunks.length = 0;
                  singleFileSize = 0;
                  mediaFileNumber++;
                }
                if (!byteRanges && hlsDeleteSegments && hlsListSize > 0) {
                  retainedSegments.push({ path: fullSegPath, duration: actualDur });
                  const expiredCount = retainedSegments.length - hlsListSize;
                  if (expiredCount > 0) {
                    // FFmpeg retains expired segments until either the count threshold or
                    // one playlist duration plus the newest expired segment is reached.
                    const playlistDuration = retainedSegments.slice(expiredCount).reduce((sum, segment) => sum + segment.duration, 0);
                    const retentionDuration = playlistDuration + retainedSegments[expiredCount - 1]!.duration;
                    let duration = 0;
                    let count = 0;
                    for (let i = expiredCount - 1; i >= 0; i--) {
                      duration += retainedSegments[i]!.duration;
                      count++;
                      if (count >= hlsDeleteThreshold || duration >= retentionDuration) break;
                    }
                    for (const segment of retainedSegments.splice(0, expiredCount - count)) {
                      await context.fs.rm(segment.path, { signal: context.signal });
                    }
                  }
                }
              }


              if (!hlsOmitEndlist) playlistLines.push("#EXT-X-ENDLIST");
              playlistLines.push("");
              const m3u8Bytes = encodeUtf8(playlistLines.join("\n"));
              await context.fs.mkdir(outDir, { recursive: true, signal: context.signal });
              const destination = hlsTempFile ? `${outResolved}.tmp` : outResolved;
              await writeFileOutput(context, m3u8Bytes, data => context.fs.writeFile(destination, data, { signal: context.signal }));
              if (destination !== outResolved) await context.fs.rename(destination, outResolved, { signal: context.signal });
              if (hlsMasterName) {
                const masterPath = resolvePath(outDir, hlsMasterName);
                const masterDir = masterPath.slice(0, masterPath.lastIndexOf("/")) || "/";
                const from = masterDir.split("/").filter(Boolean);
                const to = outResolved.split("/").filter(Boolean);
                while (from.length && from[0] === to[0]) { from.shift(); to.shift(); }
                const mediaUri = [...from.map(() => ".."), ...to].join("/");
                const tracks = workingDoc.tracks.filter(track => track.type === "video" || track.type === "audio");
                const bitrate = tracks.reduce((sum, track) => sum + Math.floor(
                  track.samples.reduce((bytes, sample) => bytes + sample.size, 0) * 8 * track.timescale / Math.max(1, track.duration)
                ), 0);
                const attributes = [`BANDWIDTH=${Math.max(1, Math.floor(bitrate * 1.1))}`];
                const video = vTrk?.codecDescriptions[0];
                if (video?.width && video.height) attributes.push(`RESOLUTION=${video.width}x${video.height}`);
                const codecs = [...new Set(tracks.flatMap(track => track.codecDescriptions
                  .flatMap(description => description.mimeCodecString ? [description.mimeCodecString] : [])))];
                if (codecs.length) attributes.push(`CODECS="${codecs.join(",")}"`);
                const master = encodeUtf8(["#EXTM3U", playlistLines[1], `#EXT-X-STREAM-INF:${attributes.join(",")}`, mediaUri, ""].join("\n"));
                await context.fs.mkdir(masterDir, { recursive: true, signal: context.signal });
                const destination = hlsTempFile ? `${masterPath}.tmp` : masterPath;
                await writeFileOutput(context, master, data => context.fs.writeFile(destination, data, { signal: context.signal }));
                if (destination !== masterPath) await context.fs.rename(destination, masterPath, { signal: context.signal });
              }
              options.onMetrics?.(budget.getStats());
              return { exitCode: decodeExitCode };
            }

            if (imageOutput && maxVideoFrames === 0) {
              options.onMetrics?.(budget.getStats());
              return { exitCode: decodeExitCode };
            }

            const imageTimeZone = strftime && !updateImage ? new TimeZone(context.env.TZ ?? "UTC") : undefined;
            const imageFileName = (number: number): string => updateImage ? outputTarget : imageTimeZone
              ? formatDate(outputTarget, millisecondsInstant(Date.now()), imageTimeZone, {
                maxOutputBytes: 1024, maxFormatWidth: 1023,
                maxArguments: Infinity, maxArgumentBytes: Infinity, maxEnvironmentEntries: Infinity
              }).slice(0, -1) // The date formatter appends a command-output newline.
              : (formatImageSequence(outputTarget, number) ?? outputTarget);

            const imagePackets: Uint8Array[] = [];
            let imagePacketBytes = 0;
            const writeImage = async (path: string, bytes: Uint8Array): Promise<void> => {
              if (imagePipe) {
                imagePacketBytes += bytes.byteLength;
                budget.checkOutputBytes(imagePacketBytes);
                budget.allocateMemory(bytes.byteLength);
                imagePackets.push(bytes);
                return;
              }
              const destination = atomicWriting ? `${path}.tmp` : path;
              await writeFileOutput(context, bytes, data => context.fs.writeFile(destination, data, { signal: context.signal }));
              if (atomicWriting) await context.fs.rename(destination, path, { signal: context.signal });
            };

            if (imageOutput && videoCodec === "copy") {
              const track = workingDoc.tracks.find(track => track.type === "video");
              const samples = track?.samples ?? [];
              if (!samples.length) throw new Error("No video packet in the requested presentation interval");
              const limit = Math.min(samples.length, maxVideoFrames ?? Infinity);
              for (let index = 0; index < limit; index++) {
                const number = framePts ? samples[index]!.pts : index + (outputStartNumber ?? 1);
                const fileName = imageFileName(number);
                if (index > 0 && fileName === outputTarget && !updateImage && !strftime && !imagePipe && !isStdout(outputTarget)) {
                  throw new Error("Cannot write more than one file with the same name. Use a numbered pattern or -update 1.");
                }
                const bytes = samples[index]!.data;
                budget.checkSamples(index + 1);
                budget.checkOutputBytes(bytes.byteLength);
                if (!imagePipe && isStdout(outputTarget)) await writeBytes(context.stdout, bytes, context.signal);
                else await writeImage(resolvePath(context.cwd, fileName), bytes);
              }
              if (imagePipe) {
                const bytes = concatBytes(imagePackets);
                await writeMediaOutput(context, outputTarget, bytes, budget);
              }
              options.onMetrics?.(budget.getStats());
              return { exitCode: decodeExitCode };
            }

            if (imageOutput && !workingDoc.tracks.some(track => track.type === "video" && track.decodedVideoFrames &&
                (track.decodedVideoFrames.length > 0 || formatImageSequence(outputTarget, outputStartNumber ?? 1) !== undefined))) {
              throw new Error("No video frame in the requested presentation interval");
            }

            if ((outputFormat ?? outputTarget.split(".").pop()?.toLowerCase()) === "ico") {
              if (videoCodec !== "png") throw new Error("ICO output requires -c:v png");
              if (maxVideoFrames === 0) return { exitCode: decodeExitCode };
              const frames: MediaVideoFrame[] = [];
              for (const track of workingDoc.tracks) {
                if (track.type !== "video") throw new Error("ICO output supports only video streams");
                const frame = (await ensureDecodedFrames(track, workingDoc.timescale, budget, context.signal, 1))[0];
                if (!frame) throw new Error("No video frame in the requested presentation interval");
                frames.push(frame);
              }
              const bytes = encodeIcoFrames(frames, budget);
              if (firstOutput) progressSize = bytes.byteLength;
              context.signal?.throwIfAborted();
              await writeMediaOutput(context, outputTarget, bytes, budget);
              options.onMetrics?.(budget.getStats());
              return { exitCode: decodeExitCode };
            }

            if ((outputFormat ?? outputTarget.split(".").pop()?.toLowerCase()) === "apng") {
              if (videoCodec === "copy") throw new Error("APNG output requires video encoding");
              if (maxVideoFrames === 0) return { exitCode: decodeExitCode };
              const track = workingDoc.tracks.find(track => track.type === "video");
              const frames = track ? await ensureDecodedFrames(track, workingDoc.timescale, budget, context.signal, maxVideoFrames) : [];
              const bytes = encodeApngFrames(frames, apngPlays, budget);
              if (firstOutput) progressSize = bytes.byteLength;
              context.signal?.throwIfAborted();
              await writeMediaOutput(context, outputTarget, bytes, budget);
              options.onMetrics?.(budget.getStats());
              return { exitCode: decodeExitCode };
            }

            // Image files share frame processing and encoding.
            if (imagePipe || (imageOutput && !isStdout(outputTarget)) || numberedImageOutput) {
              const outExt = imagePipe ? "jpg" : outputTarget.split(".").pop()?.toLowerCase() ?? "png";
              const imgPlugin = registry.findByFilename(`x.${outExt}`);
              if (!planeOutput && videoCodec === undefined && (!imgPlugin || !imgPlugin.canMux)) {
                throw new Error(`Unsupported output format for '${outputTarget}' (AST not registered)`);
              }
              const vTrack = workingDoc.tracks.find((t) => t.type === "video");
              const frames = vTrack ? await ensureDecodedFrames(vTrack, workingDoc.timescale, budget, context.signal) : [];
              const limit = maxVideoFrames ?? Infinity;
              const duration = outputFps ? 1 / outputFps : frames[0]?.durationSeconds ?? 1;
              const constantRate = ["auto", "-1", "cfr", "1"].includes(videoSync);
              let nextPts = (frames[0]?.ptsSeconds ?? 0) / duration;
              let idx = 0;
              if (planeOutput && rawPixelFormat !== undefined && rawPixelFormat !== "yuv420p") {
                throw new Error(`Unsupported image2 plane pixel format '${rawPixelFormat}'`);
              }

              for (let sourceIndex = 0; sourceIndex < frames.length && idx < limit; sourceIndex++) {
                const source = frames[sourceIndex]!;
                const delta0 = source.ptsSeconds / duration - nextPts;
                const delta = delta0 + source.durationSeconds / duration;
                if (videoSync === "vfr" || videoSync === "2") {
                  // VFR drops frames behind the next presentation tick without filling gaps.
                  if (delta <= 0.6) continue;
                  nextPts = Math.round(source.ptsSeconds / duration);
                }
                // Match FFmpeg's CFR thresholds, including its tolerance for close timestamps.
                const copies = constantRate ? (delta < -1.1 ? 0 : delta > 1.1 ? Math.round(delta) : 1) : 1;
                const previousCopies = constantRate && delta0 > 1.1 ? Math.max(0, Math.round(delta0 - 0.6)) : 0;
                if (!Number.isSafeInteger(copies)) throw new Error("Invalid output frame timestamp");
                for (let copy = 0; copy < copies && idx < limit; copy++, idx++, nextPts++) {
                  if (idx > 0 && !imagePipe && !numberedImageOutput && !updateImage && !strftime) {
                    throw new Error("Cannot write more than one file with the same name. Use a numbered pattern or -update 1.");
                  }
                  budget.checkCpu();
                  budget.checkSamples(idx + 1);
                  budget.checkDuration((idx + 1) * duration);
                  const f = copy < previousCopies && sourceIndex > 0 ? frames[sourceIndex - 1]! : source;
                  if (copy > 0) budget.recordFrame(f.width, f.height);
                  const number = framePts
                    ? Math.round((constantRate ? nextPts * duration : source.ptsSeconds) / (encoderTimeBase ?? duration))
                    : idx + (outputStartNumber ?? 1);
                  const fileName = imageFileName(number);
                  const fullOutPath = resolvePath(context.cwd, fileName);
                  if (planeOutput) {
                    const ySize = f.width * f.height;
                    const chromaSize = Math.ceil(f.width / 2) * Math.ceil(f.height / 2);
                    imagePacketBytes += ySize + 2 * chromaSize;
                    budget.checkOutputBytes(imagePacketBytes);
                    budget.allocateMemory(ySize * 5 + 2 * chromaSize);
                    const bytes = (await formatYuv(f, "yuv420p", context.signal)).native!.pixels;
                    budget.checkCpu();
                    await writeImage(fullOutPath, bytes.subarray(0, ySize));
                    await writeImage(`${fullOutPath.slice(0, -1)}U`, bytes.subarray(ySize, ySize + chromaSize));
                    await writeImage(`${fullOutPath.slice(0, -1)}V`, bytes.subarray(ySize + chromaSize));
                    continue;
                  }
                  const imgFmt = imageOutputFormat(videoCodec, outExt);
                  const encoded = (await yieldTurn(context.signal), context.signal?.throwIfAborted(), imgFmt === "tga" ? encodeTga(f, { rle, budget }) : encodeImage({ ...makeRgbaImg(f.width, f.height, f.data),
                    ...(imgFmt === "qoi" ? { hasAlpha: !["rgb24", "bgr24", "rgb48be", "gray", "gray8", "gray16be", "monob"].includes(vTrack?.codecDescriptions[0]?.pixFmt ?? "rgba") } : {}),
                    ...(vTrack?.codecDescriptions[0]?.pixFmt === "pal8"
                      ? { pngPalette: { bytes: pal8Palette, depth: 8 } } : {}),
                    ...(vTrack?.codecDescriptions[0]?.pixFmt === "monob" || vTrack?.codecDescriptions[0]?.pixFmt === "gray" || vTrack?.codecDescriptions[0]?.pixFmt === "gray8" || vTrack?.codecDescriptions[0]?.pixFmt === "gray16be"
                      ? { space: "b-w" as const, channels: 1 as const, hasAlpha: false }
                      : vTrack?.codecDescriptions[0]?.pixFmt === "ya8"
                        ? { space: "b-w" as const, channels: 2 as const, hasAlpha: true } : {}),
                    ...(imgFmt === "png" && vTrack?.codecDescriptions[0]?.sarWidth && vTrack.codecDescriptions[0].sarHeight &&
                      vTrack.codecDescriptions[0].sarWidth !== vTrack.codecDescriptions[0].sarHeight ? {
                      resolution: { x: vTrack.codecDescriptions[0].sarWidth, y: vTrack.codecDescriptions[0].sarHeight, unit: "unknown" as const }
                    } : {}) }, {
                    format: imgFmt,
                    pngPreserveColormap: vTrack?.codecDescriptions[0]?.pixFmt === "pal8",
                    pngBitDepth: vTrack?.codecDescriptions[0]?.pixFmt === "monob" ? 1 : vTrack?.codecDescriptions[0]?.pixFmt === "pal8" ? undefined : ["rgba64be", "rgb48be", "gray16be"].includes(vTrack?.codecDescriptions[0]?.pixFmt ?? "") ? 16 : 8,
                    forceOpaque: vTrack?.codecDescriptions[0]?.pixFmt === "rgb48be" || vTrack?.codecDescriptions[0]?.pixFmt === "rgb24" || vTrack?.codecDescriptions[0]?.pixFmt === "bgr24"
                  }).data);
                  budget.checkOutputBytes(encoded.byteLength);
                  await writeImage(fullOutPath, encoded);
                }
              }
              if (imagePipe) {
                const bytes = concatBytes(imagePackets);
                await writeMediaOutput(context, outputTarget, bytes, budget);
              }
              options.onMetrics?.(budget.getStats());
              return { exitCode: decodeExitCode };
            }

            if (outputFormat === "rawvideo") {
              const tracks = workingDoc.tracks.filter(track => track.type === "video");
              if (tracks.length !== 1) throw new Error("rawvideo output requires exactly one video stream");
              let track = tracks[0]!;
              if (videoCodec !== "copy") {
                if (features.videoTranscode === false) throw new Error("Video transcoding is disabled by consumer feature configuration");
                track = { ...track, decodedVideoFrames: await ensureDecodedFrames(track, workingDoc.timescale, budget, context.signal, maxVideoFrames) };
              }
              const bytes = await serializeRawVideo(track, videoCodec, rawPixelFormat, budget, context.signal);
              if (firstOutput) progressSize = bytes.byteLength;
              context.signal?.throwIfAborted();
              await writeMediaOutput(context, outputTarget, bytes, budget);
              options.onMetrics?.(budget.getStats());
              return { exitCode: decodeExitCode };
            }

            if (outputFormat === "data") {
              if (workingDoc.tracks.length !== 1) throw new Error("data output requires exactly one stream");
              const samples = workingDoc.tracks[0]!.samples;
              budget.checkOutputBytes(samples.reduce((size, sample) => size + sample.data.byteLength, 0));
              const bytes = concatBytes(samples.map(sample => sample.data));
              if (firstOutput) progressSize = bytes.byteLength;
              context.signal?.throwIfAborted();
              await writeMediaOutput(context, outputTarget, bytes, budget);
              options.onMetrics?.(budget.getStats());
              return { exitCode: decodeExitCode };
            }

            if (!checksumOutput && (!outPlugin || !outPlugin.canMux)) {
              const fmtDesc = outputFormat ?? outputTarget;
              throw new Error(
                `Unable to find a suitable output format for '${fmtDesc}' (format AST not registered)`
              );
            }

            { const gc = (globalThis as { gc?: () => void }).gc; if (typeof gc === "function") { gc(); gc(); } }
            const outExt = outputTarget.split(".").pop()?.toLowerCase();
            try {
              workingDoc = applyVideoTag(workingDoc, outPlugin?.id ?? outputFormat!, videoCodec, videoTag);
            } catch (error) {
              if (!isStdout(outputTarget) && outputTarget !== "/dev/null" && !outputTarget.startsWith("md5:")) {
                await context.fs.writeFile(resolvePath(context.cwd, outputTarget), new Uint8Array(0), { signal: context.signal });
              }
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${(error as Error).message}\n`), context.signal);
              return { exitCode: 183 };
            }
            try {
              if (!checksumOutput) validateRawAudioCodec(workingDoc, outPlugin, audioCodec);
            } catch (error) {
              if (!isStdout(outputTarget) && outputTarget !== "/dev/null" && !outputTarget.startsWith("md5:")) {
                await context.fs.writeFile(resolvePath(context.cwd, outputTarget), new Uint8Array(0), { signal: context.signal });
              }
              await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${(error as Error).message}\n`), context.signal);
              return { exitCode: 234 };
            }
            validateStreamCopy(workingDoc, outPlugin?.id ?? outputFormat!, { video: videoCodec, audio: audioCodec, subtitle: subtitleCodec });
            validateSubtitleEncoder(subtitleCodec, workingDoc, outPlugin?.id ?? outputFormat!);
            if (movieTimescale !== undefined && (outPlugin?.id === "mp4" || outPlugin?.id === "mov")) {
              workingDoc = rescaleMovie(workingDoc, movieTimescale);
            }
            if (videoTrackTimescale && (outPlugin?.id === "mp4" || outPlugin?.id === "mov")) {
              workingDoc = rescaleVideoTracks(workingDoc, videoTrackTimescale, budget);
            }
            const serializedBytes = checksumOutput
              ? (frameChecksumOutput
                ? serializeFrameChecksum(workingDoc, outputFormat!, hashAlgorithm ?? (outputFormat === "framemd5" ? "md5" : "sha256"), audioCodec, registry.findByFormatName("s16le"), budget, frameHashVersion, videoCodec, subtitleCodec, bitexact, copyTimestamps && !startAtZero)
                : serializeChecksum(workingDoc, outputFormat!, hashAlgorithm ?? (outputFormat === "md5" ? "md5" : "sha256"), audioCodec, registry.findByFormatName("s16le"), budget,
                  audioCodec === "flac" ? registry.findByFormatName("flac") : audioCodec === "adpcm_ima_wav" ? registry.findByFormatName("wav") : undefined,
                  { blockSize, trellis, compressionLevel, sampleFormat, frameSize, lpcType, channelMode, lpcPasses,
                    lpcCoeffPrecision, multiDimQuant, minPredictionOrder, maxPredictionOrder, predictionOrderMethod,
                    minPartitionOrder, maxPartitionOrder, exactRiceParameters }))
              : serializeLimitedWav(workingDoc, outPlugin!, {
              seekable: !isStdout(outputTarget) && !outputTarget.startsWith("md5:"),
              live,
              format: outputFormat ?? outExt,
              gifLoop,
              gifFlags,
              writeHeader,
              writeBext,
              patPmtAtFrames: (mpegtsFlags & 16) !== 0, patPeriod,
              writeCrc32,
              muxRate,
              pcrPeriod,
              muxDelay,
              pesPayloadSize,
              rf64,
              writePeak,
              peakBlockSize,
              peakFormat,
              peakPpv,
              audioCodec,
              videoCodec,
              maxBFrames,
              forceKeyFrames,
              audioBitrate,
              compressionLevel,
              lpcType,
              lpcPasses,
              lpcCoeffPrecision,
              minPartitionOrder,
              maxPartitionOrder,
              exactRiceParameters,
              minPredictionOrder,
              maxPredictionOrder,
              predictionOrderMethod,
              multiDimQuant,
              blockSize, trellis,
              frameSize,
              channelMode,
              sampleFormat,
              writeXing,
              useMetadataTags,
              disableChpl,
              faststart,
              writeColr,
              majorBrand,
              skipTrailer,
              defaultBaseMoof,
              segmentIndex,
              mpegtsTablesVersion,
              mpegtsServiceType,
              omitVideoPesLength,
              mpegtsLatm: !!(mpegtsFlags & 8),
              initialDiscontinuity: !!(mpegtsFlags & 32),
              mpegtsOmitRai: !!(mpegtsFlags & 64),
              fragmented,
              fragmentKeyframes: fragmentKeyframes || (fragmented && !fragmentEveryFrame && !fragmentDuration && segmentIndex !== undefined),
              fragmentEveryFrame,
              fragmentDuration,
              fragmentIndex,
              emptyMoov,
              id3v2Version,
              writeApetag,
              writeId3v2,
              writeMpeg2,
              mpegtsStartPid,
              writeId3v1,
              metadataHeaderPadding, reserveIndexSpace, cuesToFront, clusterTimeLimit,
              finalDelay,
              globalPalette,
              rle,
              pageDuration,
              serialOffset,
              mpegtsServiceId,
              metadata: metaTags,
              limits: options.limits,
              budget
            }, fileSize);
            for (const trk of workingDoc.tracks) {
              if (trk.decodedVideoFrames) {
                for (const f of trk.decodedVideoFrames) detachBytesBuffer(f.data);
              }
              if (trk.samples) {
                for (const s of trk.samples) detachBytesBuffer(s.data);
              }
            }

            budget.checkOutputBytes(serializedBytes.byteLength);
            if (firstOutput) progressSize = serializedBytes.byteLength;

            for (const destination of protocolTargets) {
              await writeMediaOutput(context, destination, serializedBytes, budget);
            }

            options.onMetrics?.(budget.getStats());
            return { exitCode: decodeExitCode };
          } catch (err) {
            rethrowRuntimeError(context, err);
            const msg = err instanceof Error ? err.message : String(err);
            await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${msg}\n`), context.signal);
            const unnamedChannel = msg.startsWith("channelmap: unavailable input channel") && msg.endsWith(" (unnamed layout)");
            const unsupportedPanOrder = msg.startsWith("pan: unsupported output channel order ");
            if (err instanceof AlimiterError || err instanceof CompandError || unnamedChannel || unsupportedPanOrder) {
              if ((unnamedChannel || unsupportedPanOrder || ((err instanceof AlimiterError || err instanceof CompandError) && err.stage === "configuration")) && outputFormat !== "null" &&
                  !isStdout(outputTarget) && outputTarget !== "/dev/null" && !outputTarget.startsWith("md5:")) {
                await context.fs.writeFile(resolvePath(context.cwd, outputTarget), new Uint8Array(0), { signal: context.signal });
              }
              return { exitCode: err instanceof CompandError ? err.exitCode : 234 };
            }
            if (msg.startsWith("pan:") && !msg.startsWith("pan: unsupported output layout ")) return { exitCode: 234 };
            if ((msg.startsWith("atrim:") && !msg.startsWith("atrim: unsupported option")) ||
                (msg.startsWith("asetnsamples:") && !msg.startsWith("asetnsamples: unsupported option")) ||
                (err instanceof RangeError && msg.startsWith("dcshift:"))) {
              return { exitCode: err instanceof RangeError ? 222 : 234 };
            }
            if (msg.startsWith("aformat: unsupported option ")) return { exitCode: 8 };
            if (msg === "aformat: invalid sample rate" || msg.startsWith("aformat: unsupported sample format ") ||
                msg.startsWith("aformat: unsupported channel layout ")) return { exitCode: 234 };
            if (msg === "acontrast: timeline is unsupported") return { exitCode: 176 };
            if (msg === "acontrast: unknown option") return { exitCode: 8 };
            if (msg === "acontrast: invalid expression" || msg === "acontrast: invalid or unsupported expression") return { exitCode: 234 };
            if (err instanceof RangeError && msg.startsWith("acontrast:")) return { exitCode: 222 };
            if (msg.startsWith("apad: unsupported option ")) return { exitCode: 8 };
            if (err instanceof RangeError && msg.startsWith("apad:")) return { exitCode: 222 };
            if (msg.startsWith("apad: invalid ") || msg === "apad: pad_len and whole_len are mutually exclusive") return { exitCode: 234 };
            if (msg.startsWith("apad packet_size:") || msg === "aloop: invalid expression" || msg === "aloop: invalid or unsupported expression" ||
                msg === "dcshift: invalid expression" || msg === "dcshift: invalid or unsupported expression" ||
                msg === "aeval: invalid expression" || msg === "aeval: invalid or unsupported expression") {
              return { exitCode: 234 };
            }
            return { exitCode: 1 };
          } finally {
            const gc = (globalThis as { gc?: () => void }).gc;
            if (typeof gc === "function") { gc(); gc(); }
          }
        });
      }
      if (outputs.length === 0) {
        await writeBytes(context.stderr, encodeUtf8("ffmpeg: must specify an output file\n"), context.signal);
        return { exitCode: 1 };
      }
      try {
        for (const initialize of initializers) {
          const result = await initialize();
          if (result) return result;
        }
      } catch (error) {
        rethrowRuntimeError(context, error);
        await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${(error as Error).message}\n`), context.signal);
        return { exitCode: 1 };
      }
      for (const output of outputs) {
        const result = await output();
        if (result.exitCode !== 0) return result;
      }
      if (abortOnEmptyOutputStream && emptyOutputStreams.length > 0) {
        for (const stream of emptyOutputStreams) {
          await writeBytes(context.stderr, encodeUtf8(`ffmpeg: Empty output stream (output stream ${stream})\n`), context.signal);
        }
        return { exitCode: 234 };
      }
      if (abortOnEmptyOutput && hasEmptyOutput) {
        await writeBytes(context.stderr, encodeUtf8("ffmpeg: Nothing was written into output file, because at least one of its streams received no packets.\n"), context.signal);
        return { exitCode: 234 };
      }
      if (progressTarget !== undefined && !(exitOnError && inputReadFailed)) {
        const elapsedSeconds = (performance.now() - progressStarted) / 1000;
        const microseconds = Math.round(progressSeconds * 1_000_000);
        const seconds = Math.floor(microseconds / 1_000_000);
        const time = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
          .map(value => String(value).padStart(2, "0")).join(":") +
          "." + String(microseconds % 1_000_000).padStart(6, "0");
        const progress = encodeUtf8([
          ...(progressFrames === undefined ? [] : [`frame=${progressFrames}`, `fps=${(elapsedSeconds > 1 ? progressFrames / elapsedSeconds : 0).toFixed(2)}`, ...progressQuality]),
          `bitrate=${progressSize !== undefined && microseconds > 0 ? `${(progressSize * 8000 / microseconds).toFixed(1)}kbits/s` : "N/A"}`,
          `total_size=${progressSize ?? "N/A"}`, `out_time_us=${hasOutputFrames ? microseconds : "N/A"}`,
          `out_time_ms=${hasOutputFrames ? microseconds : "N/A"}`, `out_time=${hasOutputFrames ? time : "N/A"}`, "dup_frames=0",
          "drop_frames=0", `speed=${progressSeconds > 0 && elapsedSeconds > 0 ? `${(progressSeconds / elapsedSeconds).toPrecision(3)}x` : "N/A"}`, "progress=end", ""
        ].join("\n"));
        try {
          if (isStdout(progressTarget) || progressTarget === "pipe:2") {
            await writeBytes(progressTarget === "pipe:2" ? context.stderr : context.stdout, progress, context.signal);
          } else {
            await writeFileOutput(context, progress, bytes =>
              context.fs.writeFile(resolvePath(context.cwd, progressTarget), bytes, { signal: context.signal }));
          }
        } catch (err) {
          rethrowRuntimeError(context, err);
          const msg = err instanceof Error ? err.message : String(err);
          await writeBytes(context.stderr, encodeUtf8(`ffmpeg: ${msg}\n`), context.signal);
          return { exitCode: 1 };
        }
      }
      return { exitCode: exitOnError && inputReadFailed ? 1 : 0 };
    }
  };
}

export type FfmpegCommandPair = readonly [CommandDefinition, CommandDefinition] & {
  readonly ffmpeg: CommandDefinition;
  readonly ffprobe: CommandDefinition;
};

export function createFfmpegCommands(
  options: FfmpegCommandsOptions = {}
): FfmpegCommandPair {
  const ffmpeg = createFfmpegCommand(options);
  const ffprobe = createFfprobeCommand(options);
  return Object.assign([ffmpeg, ffprobe] as const, { ffmpeg, ffprobe });
}

export function ffmpegCommands(options: FfmpegCommandsOptions = {}): VirtualShellPlugin {
  const definitions = createFfmpegCommands(options);
  return {
    name: "ffmpeg-commands",
    setup(host) {
      if (!options.replace) {
        for (const definition of definitions) {
          if (host.commands.has(definition.name)) {
            throw new Error(`Command already registered: ${definition.name}`);
          }
        }
      }
      for (const definition of definitions) {
        host.commands.register(definition, { replace: options.replace ?? false });
      }
    }
  };
}

async function mapWork<T, R>(items: readonly T[], transform: (item: T, index: number) => R | Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const result: R[] = [];
  for (let index = 0; index < items.length; index++) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    result.push(await transform(items[index]!, index));
  }
  return result;
}

async function muxMp4Cooperatively(sources: readonly MediaDocument[], options: MuxMediaOptions, signal?: AbortSignal): Promise<MediaDocument> {
  const work = muxMp4Steps(sources, options);
  try {
    let step = work.next();
    while (!step.done) {
      await yieldTurn(signal);
      signal?.throwIfAborted();
      step = work.next();
    }
    return step.value;
  } finally { work.return(undefined as unknown as MediaDocument); }
}
