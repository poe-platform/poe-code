import { ripemd128, ripemd256, ripemd320 } from "./ripemd.js";
import { md5, sha1, ripemd160 } from "@noble/hashes/legacy.js";
import { sha224, sha256, sha384, sha512, sha512_224, sha512_256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { demuxVorbisTrack, decodeAacFrames, decodeVorbisFrames, encodeUtf8, concatBytes, rgbaToYuv420p, type MediaTrack, type MediaVideoFrame, type MediaDocument, type MediaAstPlugin, type MediaBudgetTracker } from "@poe-code/mp4-ast";

export const crc32Table = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

function videoTimeBase(track: MediaTrack): [number, number] {
  const ticks = Math.max(1, Math.round((track.decodedVideoFrames?.[0]?.durationSeconds ??
    (track.samples[0]?.duration ?? 1) / track.timescale) * track.timescale));
  let a = ticks, b = track.timescale;
  while (b) [a, b] = [b, a % b];
  return [ticks / a, track.timescale / a];
}

function videoBytes(frame: MediaVideoFrame, format: string, budget: MediaBudgetTracker): Uint8Array {
  const native = frame.native;
  if (native && native.rgba === frame.data && native.width === frame.width && native.height === frame.height) {
    return native.pixels;
  }
  if (format === "yuv420p") {
    const { y, u, v } = rgbaToYuv420p(frame.data, frame.width, frame.height);
    return concatBytes([y, u, v]);
  }
  const channels = ({ rgba: [0, 1, 2, 3], rgb24: [0, 1, 2], bgr24: [2, 1, 0],
    bgra: [2, 1, 0, 3], gray: [0], gray8: [0], ya8: [0, 3] } as Record<string, number[]>)[format];
  if (!channels) throw new Error(`Unsupported rawvideo pixel format '${format}'`);
  const bytes = new Uint8Array(frame.width * frame.height * channels.length);
  for (let i = 0; i < frame.width * frame.height; i++) {
    if (i % 4096 === 0) budget.checkCpu();
    for (const [j, channel] of channels.entries()) bytes[i * channels.length + j] = frame.data[i * 4 + channel]!;
  }
  return bytes;
}

function frameCrc(bytes: Uint8Array, budget: MediaBudgetTracker): string {
  // Unlike the whole-output crc muxer, framecrc starts Adler-32 at zero.
  let a = 0, b = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (i % 4096 === 0) budget.checkCpu();
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return `0x${((b * 65536 + a) >>> 0).toString(16).padStart(8, "0")}`;
}

export function serializeFrameChecksum(
  doc: MediaDocument,
  format: string,
  algorithm: string,
  audioCodec: string | undefined,
  rawAudio: MediaAstPlugin | undefined,
  budget: MediaBudgetTracker,
  formatVersion = 2,
  videoCodec?: string,
  subtitleCodec?: string,
  bitexact = false,
  copyTimestamps = false
): Uint8Array {
  if (audioCodec === "copy") {
    doc = { ...doc, tracks: doc.tracks.map(track => track.type === "audio" &&
      track.codecDescriptions[0]?.codecName === "vorbis" && !track.codecDescriptions[0].extraData
      ? demuxVorbisTrack(track) : track) };
  }
  const name = algorithm.toLowerCase();
  const hashes = { md5, sha160: sha1, sha224, sha256, sha384, sha512, ripemd128, ripemd160, ripemd256, ripemd320, "sha512/224": sha512_224, "sha512/256": sha512_256 };
  if (format !== "framecrc" && name !== "crc32" && !Object.hasOwn(hashes, name)) throw new Error(`Unknown hash algorithm '${algorithm}'`);
  function checksum(bytes: Uint8Array): string {
    if (format === "framecrc") {
      return frameCrc(bytes, budget);
    } else if (name === "crc32") {
      let crc = 0xffffffff;
      for (let i = 0; i < bytes.length; i++) {
        if (i % 4096 === 0) budget.checkCpu();
        crc = (crc >>> 8) ^ crc32Table[(crc ^ bytes[i]!) & 255]!;
      }
      return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
    } else {
      const hash = hashes[name as keyof typeof hashes].create();
      for (let i = 0; i < bytes.length; i += 65536) {
        budget.checkCpu();
        hash.update(bytes.subarray(i, i + 65536));
      }
      return bytesToHex(hash.digest());
    }
  }
  const lines = format === "framecrc" ? [] : ["#format: frame checksums", `#version: ${formatVersion}`, `#hash: ${name.toUpperCase()}`];
  for (const [index, track] of doc.tracks.entries()) {
    if ((track.type === "video" ? videoCodec : track.type === "subtitle" ? subtitleCodec : audioCodec) !== "copy") continue;
    const codec = track.codecDescriptions[0];
    let extra = codec?.extraData;
    // The FLAC AST retains the file metadata for remuxing; codec extradata is STREAMINFO only.
    if (codec?.codecName === "flac" && extra && extra[0] === 0x66 && extra[1] === 0x4c &&
        extra[2] === 0x61 && extra[3] === 0x43) extra = extra.subarray(8, 42);
    if (extra?.length) lines.push(format === "framecrc"
      ? `#extradata ${index}: ${String(extra.length).padStart(8)}, ${checksum(extra)}`
      : `#extradata ${index}, ${String(extra.length).padStart(31)}, ${checksum(extra)}`);
  }
  if (format === "framecrc" && !bitexact) lines.push("#software: Lavf61.7.100");
  for (const [index, track] of doc.tracks.entries()) {
    if (track.type === "video") {
      if (videoCodec && videoCodec !== "rawvideo" && videoCodec !== "copy") throw new Error(`Unsupported frame checksum video codec '${videoCodec}'`);
      const [num, den] = videoCodec === "copy" ? [1, track.timescale] : videoTimeBase(track);
      const codec = track.codecDescriptions[0];
      lines.push(`#tb ${index}: ${num}/${den}`, `#media_type ${index}: video`,
        `#codec_id ${index}: ${videoCodec === "copy" ? codec?.codecName : "rawvideo"}`,
        `#dimensions ${index}: ${track.width}x${track.height}`,
        `#sar ${index}: ${codec?.sarWidth ?? 1}/${codec?.sarHeight ?? 1}`);
      continue;
    }
    if (track.type === "subtitle" && subtitleCodec === "copy") {
      lines.push(`#tb ${index}: 1/${track.timescale}`, `#media_type ${index}: subtitle`,
        `#codec_id ${index}: ${track.codecDescriptions[0]?.codecName}`);
      continue;
    }
    if (track.type !== "audio") throw new Error("Frame checksum output requires audio, video, or copied subtitle streams");
    const copy = audioCodec === "copy";
    const rate = track.decodedAudio?.sampleRate ?? track.codecDescriptions[0]?.sampleRate ?? track.timescale;
    const channels = track.decodedAudio?.channels ?? track.codecDescriptions[0]?.channels ?? 0;
    const mask = track.decodedAudio?.channelMask;
    const layouts: Record<number, string> = {
      4: "mono", 3: "stereo", 11: "2.1", 7: "3.0", 259: "3.0(back)",
      15: "3.1", 263: "4.0", 51: "quad", 1539: "quad(side)",
      271: "4.1", 55: "5.0", 1543: "5.0(side)", 63: "5.1", 1551: "5.1(side)",
      1799: "6.0", 1807: "6.1", 1591: "7.0", 1599: "7.1", 255: "7.1(wide)"
    };
    const speakers = mask ? ["FL", "FR", "FC", "LFE", "BL", "BR", "FLC", "FRC", "BC", "SL", "SR", "TC", "TFL", "TFC", "TFR", "TBL", "TBC", "TBR"]
      .filter((_, bit) => (mask & (2 ** bit)) !== 0) : [];
    const layout = mask && speakers.length === channels
      ? layouts[mask] ?? `${channels} channels (${speakers.join("+")})`
      : (track.codecDescriptions[0]?.channels === channels ? track.codecDescriptions[0]?.channelLayout : undefined) ??
        ["0 channels", "mono", "stereo", "2.1", "4.0", "5.0", "5.1", "6.1", "7.1"][channels] ?? `${channels} channels`;
    lines.push(`#tb ${index}: 1/${copy ? track.timescale : rate}`, `#media_type ${index}: audio`,
      `#codec_id ${index}: ${copy ? track.codecDescriptions[0]?.codecName : audioCodec ?? "pcm_s16le"}`,
      `#sample_rate ${index}: ${track.decodedAudio?.sampleRate ?? track.codecDescriptions[0]?.sampleRate ?? rate}`, `#channel_layout_name ${index}: ${layout}`);
  }
  if (format !== "framecrc") lines.push("#stream#, dts,        pts, duration,     size, hash");
  const rows: { dts: number; rate: number; line: string }[] = [];
  for (const [index, track] of doc.tracks.entries()) {
    const video = track.type === "video";
    const copy = (video ? videoCodec : track.type === "subtitle" ? subtitleCodec : audioCodec) === "copy";
    const copiedAudio = copy && track.type === "audio";
    const codec = track.codecDescriptions[0];
    let timestampOffset = 0, mediaStart = 0, skipSamples = 0;
    if (copiedAudio) {
      for (const edit of track.editList ?? []) {
        if (edit.mediaTime < 0) timestampOffset += edit.segmentDuration * track.timescale / doc.timescale;
        else { mediaStart = edit.mediaTime; timestampOffset -= mediaStart; break; }
      }
      if (codec?.codecName === "mp3") {
        for (const sample of track.samples) {
          budget.checkCpu();
          skipSamples += sample.skipSamples ?? 0;
        }
        if (!track.editList?.length && !copyTimestamps) {
          // FFmpeg rebases the demuxer start time through AV_TIME_BASE (microseconds).
          timestampOffset -= Math.round(Math.round(skipSamples * 1e6 / (codec.sampleRate ?? track.timescale)) * track.timescale / 1e6);
        }
      }
    }
    if (track.type === "audio" && !rawAudio?.canMux) throw new Error("Raw audio AST is not registered");
    const decodedAudioPackets: Pick<MediaTrack["samples"][number], "dts" | "pts" | "duration" | "data">[] | undefined =
      track.type === "audio" && !copy && (!track.decodedAudio ||
        codec?.codecName === "aac" && track.samples.some(sample => sample.data.length > 0)) &&
        ["aac", "vorbis"].includes(codec?.codecName ?? "") ? [] : undefined;
    if (decodedAudioPackets && track.codecDescriptions[0]?.codecName === "vorbis") {
      for (const frame of decodeVorbisFrames(track)) {
        budget.checkCpu();
        const duration = frame.channelData[0]!.length / frame.sampleRate * track.timescale;
        const pts = frame.pts / frame.sampleRate * track.timescale;
        const data = rawAudio!.serialize({ ...doc, tracks: [{ ...track,
          decodedAudio: { sampleRate: frame.sampleRate, channels: frame.channelData.length, channelData: frame.channelData }
        }] }, { audioCodec, budget });
        budget.allocateMemory(data.length);
        decodedAudioPackets.push({ dts: pts, pts, duration, data });
      }
    } else if (decodedAudioPackets) {
      const edits = track.editList?.length ? track.editList : [{
        mediaTime: track.samples[0]?.pts ?? 0,
        segmentDuration: track.duration / track.timescale * doc.timescale,
        mediaRateInteger: 1, mediaRateFraction: 0
      }];
      for (const edit of edits) {
        if (edit.mediaRateInteger !== 1 || edit.mediaRateFraction !== 0 || edit.mediaTime < -1) {
          throw new Error("Unsupported AAC edit rate or media time");
        }
      }
      for (const frame of decodeAacFrames(track)) {
        budget.checkCpu();
        let presentation = 0;
        for (const edit of edits) {
          const length = edit.segmentDuration / doc.timescale * track.timescale;
          const skip = Math.max(0, Math.round((edit.mediaTime - frame.pts) / track.timescale * frame.sampleRate));
          // Drop preroll, but retain the final decoder frame beyond the presentation end.
          if (edit.mediaTime !== -1 && frame.pts < edit.mediaTime + length && skip < frame.channelData[0]!.length) {
            const channelData = frame.channelData.map(channel => channel.subarray(skip));
            const duration = channelData[0]!.length / frame.sampleRate * track.timescale;
            const pts = presentation + Math.max(0, frame.pts - edit.mediaTime);
            const data = rawAudio!.serialize({ ...doc, tracks: [{ ...track,
              decodedAudio: { sampleRate: frame.sampleRate, channels: channelData.length, channelData }
            }] }, { audioCodec, budget });
            budget.allocateMemory(data.length);
            decodedAudioPackets.push({ dts: pts, pts, duration, data });
          }
          presentation += length;
        }
      }
    }
    const [num, den] = video && !copy ? videoTimeBase(track) : [1, track.timescale];
    const rate = video ? den / num : copy ? track.timescale : track.decodedAudio?.sampleRate ?? track.codecDescriptions[0]?.sampleRate ?? track.timescale;
    const payload = track.type !== "audio" || decodedAudioPackets ? new Uint8Array() : rawAudio!.serialize({ ...doc, tracks: [track] }, { audioCodec, budget });
    let audioPackets = track.samples;
    if (!copy && track.decodedAudio && codec?.codecName.startsWith("pcm_") &&
        audioPackets.every(packet => packet.data.length > 0)) {
      // PCM frame sizes are exact; container timestamps may be rounded to milliseconds.
      const stride = (codec.bitsPerSample ?? 0) / 8 * (codec.channels ?? 0);
      if (stride > 0) {
        let end = Math.round((audioPackets[0]?.pts ?? 0) * rate / track.timescale);
        audioPackets = audioPackets.map(packet => {
          budget.checkCpu();
          const timestamp = Math.round(packet.pts * rate / track.timescale);
          const pts = Math.abs(timestamp - end) <= rate / track.timescale ? end : timestamp;
          const duration = packet.data.length / stride;
          end = pts + duration;
          return { ...packet, dts: pts * track.timescale / rate, pts: pts * track.timescale / rate,
            duration: duration * track.timescale / rate };
        });
      }
    }
    if (track.type === "audio" && !copy && track.codecDescriptions[0]?.codecName === "mp3" && !track.decodedAudio) {
      // The PCM decoder removes encoder delay and padding, including entire packets.
      const ticksPerSample = track.timescale / rate;
      audioPackets = track.samples.map(packet => ({
        ...packet,
        dts: packet.dts + (packet.skipSamples ?? 0) * ticksPerSample,
        pts: packet.pts + (packet.skipSamples ?? 0) * ticksPerSample,
        duration: packet.duration - ((packet.skipSamples ?? 0) + (packet.discardPadding ?? 0)) * ticksPerSample
      })).filter(packet => packet.duration > 0);
      const origin = audioPackets[0]?.pts ?? 0;
      audioPackets = audioPackets.map(packet => ({ ...packet, dts: packet.dts - origin, pts: packet.pts - origin }));
    }
    const frames = track.decodedAudio?.channelData[0]?.length ?? Math.round(
      (audioPackets !== track.samples ? audioPackets.reduce((sum, packet) => sum + packet.duration, 0) : track.duration) * rate / track.timescale);
    const bytesPerFrame = frames ? payload.length / frames : 0;
    let offset = 0;
    if (video && !copy && !track.decodedVideoFrames) throw new Error("Frame checksum output requires decoded video frames");
    const packets = video && !copy ? track.decodedVideoFrames!.map(frame => ({
      dts: frame.ptsSeconds * track.timescale, pts: frame.ptsSeconds * track.timescale,
      duration: frame.durationSeconds * track.timescale, frame
    })) : decodedAudioPackets ?? (audioPackets.length ? audioPackets : payload.length ? [{ dts: 0, pts: 0, duration: track.duration, data: payload }] : []);
    let previousDts = -Infinity;
    for (const packet of packets) {
      budget.checkCpu();
      // MOV's final empty text sample terminates the track; FFmpeg emits no packet for it.
      if (track.type === "subtitle" && track.codecDescriptions[0]?.codecName === "mov_text" &&
          packet === track.samples.at(-1) && packet.duration === 0 && "data" in packet &&
          (packet.data.length === 0 || packet.data.length === 2 && packet.data[0] === 0 && packet.data[1] === 0)) continue;
      const duration = Math.round(packet.duration * rate / track.timescale);
      const bytes = "frame" in packet ? videoBytes(packet.frame, track.codecDescriptions[0]?.pixFmt ?? "rgba", budget)
        : track.type !== "audio" || decodedAudioPackets ? packet.data : payload.subarray(offset, offset + (copy ? packet.data.length : Math.min(payload.length - offset, Math.round(duration * bytesPerFrame))));
      const size = bytes.length;
      offset += size;
      const digest = checksum(bytes);
      let annotations = "";
      if (format === "framecrc" && copiedAudio && "data" in packet) {
        const discard = codec?.codecName === "aac" && packet.pts + packet.duration <= mediaStart;
        if (discard) annotations += ", F=0x5";
        const skip = codec?.codecName === "mp3"
          ? packet === track.samples[0] && skipSamples > 0
          : ("skipSamples" in packet && packet.skipSamples) ||
            (codec?.codecName === "aac" && packet === track.samples[0] && packet.pts < mediaStart);
        if (skip || ("discardPadding" in packet && packet.discardPadding)) annotations += ", S=1,       10";
      }
      let dts = Math.round((packet.dts + timestampOffset) * rate / track.timescale);
      let pts = Math.round((packet.pts + timestampOffset) * rate / track.timescale);
      // FFmpeg corrects backward audio DTS before interleaving; negative starts remain valid.
      if (track.type === "audio" && dts < previousDts) {
        dts = previousDts;
        pts = Math.max(pts, dts);
      }
      previousDts = dts;
      rows.push({ dts, rate,
        line: `${index}, ${String(dts).padStart(10)}, ${String(pts).padStart(10)}, ${String(duration).padStart(8)}, ${String(size).padStart(8)}, ${digest}${annotations}` });
    }
  }
  // Stable sorting preserves output stream order at equal packet timestamps.
  rows.sort((a, b) => {
    budget.checkCpu();
    return a.dts * b.rate - b.dts * a.rate;
  });
  for (const row of rows) lines.push(row.line);
  return encodeUtf8(`${lines.join("\n")}\n`);
}
