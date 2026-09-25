import {
  BinaryWriter,
  concatBytes
} from "../binary.js";
import {
  annexBToAvcc,
  avccToAnnexB,
  buildAudioSpecificConfig,
  buildAvcC,
  buildEsdsBox,
  buildH264SpsPps,
  createSilentAacFrame,
  decodeH264FrameToRgba,
  encodeH264IdrFrame,
  parseAdtsStream,
  parseAvcC,
  parseH264Sps,
  wrapAdtsFrame
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

export function isMpegTsSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength >= 188 && bytes[0] === 0x47) {
    if (bytes.byteLength < 376 || bytes[188] === 0x47) return true;
  }
  if (bytes.byteLength >= 192 && bytes[4] === 0x47) {
    if (bytes.byteLength < 384 || bytes[196] === 0x47) return true;
  }
  return false;
}

function mpeg2Crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.byteLength; i++) {
    crc ^= data[i]! << 24;
    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x80000000) !== 0) {
        crc = ((crc << 1) ^ 0x04c11db7) >>> 0;
      } else {
        crc = (crc << 1) >>> 0;
      }
    }
  }
  return crc >>> 0;
}

function parsePesTimestamp(bytes: Uint8Array, offset: number): number {
  if (offset + 5 > bytes.byteLength) return 0;
  const b0 = bytes[offset]!;
  const b1 = bytes[offset + 1]!;
  const b2 = bytes[offset + 2]!;
  const b3 = bytes[offset + 3]!;
  const b4 = bytes[offset + 4]!;
  return (
    ((b0 & 0x0e) * 536870912) +
    ((b1 & 0xff) << 22) +
    (((b2 & 0xfe) >>> 1) << 15) +
    ((b3 & 0xff) << 7) +
    ((b4 & 0xfe) >>> 1)
  );
}

function writePesTimestamp(prefixNibbles: number, pts90k: number): Uint8Array {
  const t = Math.max(0, Math.floor(pts90k));
  const b0 = ((prefixNibbles & 0x0f) << 4) | (((t / 1073741824) & 0x07) << 1) | 1;
  const b1 = (t >>> 22) & 0xff;
  const b2 = (((t >>> 15) & 0x7f) << 1) | 1;
  const b3 = (t >>> 7) & 0xff;
  const b4 = ((t & 0x7f) << 1) | 1;
  return new Uint8Array([b0, b1, b2, b3, b4]);
}

export function parseMpegTs(bytes: Uint8Array, options: ParseMediaOptions = {}): MediaDocument {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.byteLength);

  if (!isMpegTsSignature(bytes)) {
    throw new Error("Invalid MPEG-TS stream: missing 0x47 sync byte");
  }

  const stride = bytes[0] === 0x47 ? 188 : 192;
  const pktOffset = stride === 192 ? 4 : 0;

  let pmtPid = 0x1000;
  const pidStreamTypes = new Map<number, number>();
  const pesAccumulators = new Map<number, Uint8Array[]>();
  const pesPacketsByPid = new Map<
    number,
    { pts: number; dts: number; data: Uint8Array }[]
  >();

  const flushPes = (pid: number) => {
    const chunks = pesAccumulators.get(pid);
    if (!chunks || chunks.length === 0) return;
    pesAccumulators.set(pid, []);
    const full = concatBytes(chunks);
    if (full.byteLength < 9) return;
    if (full[0] !== 0x00 || full[1] !== 0x00 || full[2] !== 0x01) return;

    const flags2 = full[7]!;
    const headerDataLen = full[8]!;
    const payloadStart = 9 + headerDataLen;
    if (payloadStart > full.byteLength) return;

    let pts = 0;
    let dts = 0;
    const ptsDtsFlags = (flags2 >>> 6) & 0x03;
    if (ptsDtsFlags >= 2 && full.byteLength >= 14) {
      pts = parsePesTimestamp(full, 9);
      dts = pts;
      if (ptsDtsFlags === 3 && full.byteLength >= 19) {
        dts = parsePesTimestamp(full, 14);
      }
    }

    let list = pesPacketsByPid.get(pid);
    if (!list) {
      list = [];
      pesPacketsByPid.set(pid, list);
    }
    list.push({
      pts,
      dts,
      data: full.subarray(payloadStart)
    });
  };

  for (let pos = 0; pos + stride <= bytes.byteLength; pos += stride) {
    const pkt = bytes.subarray(pos + pktOffset, pos + pktOffset + 188);
    if (pkt[0] !== 0x47) continue;

    const payloadUnitStart = (pkt[1]! & 0x40) !== 0;
    const pid = ((pkt[1]! & 0x1f) << 8) | pkt[2]!;
    const adaptationControl = (pkt[3]! >>> 4) & 0x03;

    let cursor = 4;
    if (adaptationControl === 2 || adaptationControl === 3) {
      const adaptationLen = pkt[4] ?? 0;
      cursor += 1 + adaptationLen;
    }
    if (adaptationControl === 2 || cursor >= 188) continue;

    const payload = pkt.subarray(cursor, 188);

    if (pid === 0x0000) {
      // PAT
      const ptr = payloadUnitStart ? (payload[0] ?? 0) + 1 : 0;
      const section = payload.subarray(ptr);
      if (section.byteLength >= 12 && section[0] === 0x00) {
        const sectionLen = ((section[1]! & 0x0f) << 8) | section[2]!;
        const progEnd = Math.min(section.byteLength, 3 + sectionLen - 4);
        for (let i = 8; i + 4 <= progEnd; i += 4) {
          const progNum = (section[i]! << 8) | section[i + 1]!;
          const pPid = ((section[i + 2]! & 0x1f) << 8) | section[i + 3]!;
          if (progNum !== 0) {
            pmtPid = pPid;
          }
        }
      }
      continue;
    }

    if (pid === pmtPid) {
      // PMT
      const ptr = payloadUnitStart ? (payload[0] ?? 0) + 1 : 0;
      const section = payload.subarray(ptr);
      if (section.byteLength >= 16 && section[0] === 0x02) {
        const sectionLen = ((section[1]! & 0x0f) << 8) | section[2]!;
        const progInfoLen = ((section[10]! & 0x0f) << 8) | section[11]!;
        const streamsEnd = Math.min(section.byteLength, 3 + sectionLen - 4);
        let sPos = 12 + progInfoLen;
        while (sPos + 5 <= streamsEnd) {
          const streamType = section[sPos]!;
          const elemPid = ((section[sPos + 1]! & 0x1f) << 8) | section[sPos + 2]!;
          const esInfoLen = ((section[sPos + 3]! & 0x0f) << 8) | section[sPos + 4]!;
          pidStreamTypes.set(elemPid, streamType);
          sPos += 5 + esInfoLen;
        }
      }
      continue;
    }

    if (pid === 0x1fff) continue;

    // Elementary stream PES packet
    if (!pidStreamTypes.has(pid)) {
      // Heuristic detection if PAT/PMT missing
      if (payloadUnitStart && payload.byteLength >= 4 && payload[0] === 0 && payload[1] === 0 && payload[2] === 1) {
        const streamId = payload[3]!;
        if (streamId >= 0xe0 && streamId <= 0xef) pidStreamTypes.set(pid, 0x1b);
        else if (streamId >= 0xc0 && streamId <= 0xdf) pidStreamTypes.set(pid, 0x0f);
      }
    }

    if (payloadUnitStart) {
      flushPes(pid);
      pesAccumulators.set(pid, [payload]);
    } else {
      let acc = pesAccumulators.get(pid);
      if (!acc) {
        acc = [];
        pesAccumulators.set(pid, acc);
      }
      acc.push(payload);
    }
  }

  for (const pid of pesAccumulators.keys()) {
    flushPes(pid);
  }

  const tracks: MediaTrack[] = [];
  let trackId = 1;

  for (const [pid, packets] of pesPacketsByPid.entries()) {
    if (packets.length === 0) continue;
    const streamType = pidStreamTypes.get(pid) ?? 0x1b;

    if (streamType === 0x1b || streamType === 0x24) {
      // Video stream (H.264 Annex-B or HEVC)
      let allSps: Uint8Array[] = [];
      let allPps: Uint8Array[] = [];
      const samples: MediaSample[] = [];
      const basePts = packets[0]!.dts || packets[0]!.pts || 0;

      for (let i = 0; i < packets.length; i++) {
        const pkt = packets[i]!;
        const nextPkt = packets[i + 1];
        const converted = annexBToAvcc(pkt.data);
        if (converted.sps.length > 0) allSps = converted.sps;
        if (converted.pps.length > 0) allPps = converted.pps;

        const dts = Math.max(0, (pkt.dts || pkt.pts) - basePts);
        const pts = Math.max(0, pkt.pts - basePts);
        const nextDts = nextPkt
          ? Math.max(dts + 1, (nextPkt.dts || nextPkt.pts) - basePts)
          : dts + 3000;
        const duration = Math.max(1, nextDts - dts);

        const sampleData =
          converted.avccData.byteLength > 0 ? converted.avccData : pkt.data;
        samples.push({
          data: sampleData,
          dts,
          pts,
          cts: pts - dts,
          duration,
          size: sampleData.byteLength,
          isKeyframe: converted.isKeyframe || i === 0,
          sampleDescriptionIndex: 1
        });
      }

      let width = 320;
      let height = 240;
      let profile = "Baseline";
      if (allSps[0]) {
        const parsedSps = parseH264Sps(allSps[0]);
        width = parsedSps.width;
        height = parsedSps.height;
        profile = parsedSps.profileName;
      } else {
        const generated = buildH264SpsPps(width, height, 30);
        allSps = [generated.sps];
        allPps = [generated.pps];
      }

      const avcCBytes = buildAvcC(allSps, allPps);
      const avcC = parseAvcC(avcCBytes);
      const totalDur = samples.reduce((acc, s) => acc + s.duration, 0);

      let decodedVideoFrames: MediaVideoFrame[] | undefined;
      if (options.decodeFrames) {
        decodedVideoFrames = samples.map((s) => ({
          width,
          height,
          data: decodeH264FrameToRgba(s.data, width, height, 4),
          ptsSeconds: s.pts / 90000,
          durationSeconds: s.duration / 90000,
          keyframe: s.isKeyframe
        }));
      }

      tracks.push({
        id: trackId++,
        type: "video",
        handlerType: "vide",
        timescale: 90000,
        duration: totalDur,
        language: "und",
        enabled: true,
        width,
        height,
        codecDescriptions: [
          {
            formatFourCC: streamType === 0x24 ? "hvc1" : "avc1",
            codecName: streamType === 0x24 ? "hevc" : "h264",
            profile,
            width,
            height,
            pixFmt: "yuv420p",
            avcC
          }
        ],
        samples,
        decodedVideoFrames
      });
    } else if (streamType === 0x0f || streamType === 0x03 || streamType === 0x04) {
      // Audio stream (ADTS AAC or MP3)
      const combinedAudioBytes = concatBytes(packets.map((p) => p.data));
      const adts = parseAdtsStream(combinedAudioBytes);
      const sampleRate = adts.sampleRate || 44100;
      const channels = adts.channels || 2;
      const samples: MediaSample[] = [];

      if (adts.frames.length > 0) {
        for (let i = 0; i < adts.frames.length; i++) {
          const frame = adts.frames[i]!;
          samples.push({
            data: frame,
            dts: i * 1024,
            pts: i * 1024,
            cts: 0,
            duration: 1024,
            size: frame.byteLength,
            isKeyframe: true,
            sampleDescriptionIndex: 1
          });
        }
      } else {
        for (let i = 0; i < packets.length; i++) {
          const p = packets[i]!;
          samples.push({
            data: p.data,
            dts: i * 1024,
            pts: i * 1024,
            cts: 0,
            duration: 1024,
            size: p.data.byteLength,
            isKeyframe: true,
            sampleDescriptionIndex: 1
          });
        }
      }

      const asc = buildAudioSpecificConfig(sampleRate, channels, adts.audioObjectType || 2);
      const desc: MediaCodecDescription = {
        formatFourCC: streamType === 0x0f ? "mp4a" : ".mp3",
        codecName: streamType === 0x0f ? "aac" : "mp3",
        profile: "LC",
        sampleRate,
        channels,
        bitsPerSample: 16,
        esds: {
          objectTypeIndication: 0x40,
          audioObjectType: 2,
          sampleRate,
          channelCount: channels,
          maxBitrate: 128000,
          avgBitrate: 128000,
          decoderSpecificInfo: asc,
          rawEsdsBytes: buildEsdsBox(sampleRate, channels, 128000, asc).subarray(8)
        }
      };

      tracks.push({
        id: trackId++,
        type: "audio",
        handlerType: "soun",
        timescale: sampleRate,
        duration: samples.length * 1024,
        language: "und",
        enabled: true,
        codecDescriptions: [desc],
        samples
      });
    }
  }

  let maxSec = 0;
  for (const t of tracks) {
    const sec = t.duration / Math.max(1, t.timescale);
    if (sec > maxSec) maxSec = sec;
  }

  return {
    containerFormat: "mpegts",
    timescale: 90000,
    duration: Math.round(maxSec * 90000),
    durationSeconds: maxSec,
    tracks,
    metadata: {},
    byteLength: bytes.byteLength
  };
}

export function serializeMpegTs(
  doc: MediaDocument,
  options: SerializeMediaOptions = {}
): Uint8Array {
  void options;
  const tsPackets: Uint8Array[] = [];
  const ccByPid = new Map<number, number>();

  const nextCc = (pid: number): number => {
    const cc = ccByPid.get(pid) ?? 0;
    ccByPid.set(pid, (cc + 1) & 0x0f);
    return cc;
  };

  const emitSectionPacket = (pid: number, section: Uint8Array) => {
    const pkt = new Uint8Array(188).fill(0xff);
    pkt[0] = 0x47;
    pkt[1] = 0x40 | ((pid >>> 8) & 0x1f);
    pkt[2] = pid & 0xff;
    pkt[3] = 0x10 | nextCc(pid);
    pkt[4] = 0x00; // pointer_field = 0
    pkt.set(section.subarray(0, Math.min(183, section.byteLength)), 5);
    tsPackets.push(pkt);
  };

  const emitPesPackets = (
    pid: number,
    streamId: number,
    pts90k: number,
    dts90k: number,
    esPayload: Uint8Array,
    withPcr: boolean
  ) => {
    const hasDts = Math.abs(pts90k - dts90k) > 0;
    const headerDataLen = hasDts ? 10 : 5;
    const pesHeader = new BinaryWriter(9 + headerDataLen);
    pesHeader.writeU8(0x00);
    pesHeader.writeU8(0x00);
    pesHeader.writeU8(0x01);
    pesHeader.writeU8(streamId);
    const pesLen = 3 + headerDataLen + esPayload.byteLength;
    pesHeader.writeU16BE(pesLen <= 0xffff ? pesLen : 0);
    pesHeader.writeU8(0x80); // '10', data_alignment_indicator = 0
    pesHeader.writeU8(hasDts ? 0xc0 : 0x80);
    pesHeader.writeU8(headerDataLen);
    pesHeader.writeBytes(writePesTimestamp(hasDts ? 0x03 : 0x02, pts90k));
    if (hasDts) {
      pesHeader.writeBytes(writePesTimestamp(0x01, dts90k));
    }

    const fullPes = concatBytes([pesHeader.toUint8Array(), esPayload]);
    let offset = 0;
    let first = true;

    while (offset < fullPes.byteLength) {
      const pkt = new Uint8Array(188).fill(0xff);
      pkt[0] = 0x47;
      pkt[1] = (first ? 0x40 : 0x00) | ((pid >>> 8) & 0x1f);
      pkt[2] = pid & 0xff;

      const remaining = fullPes.byteLength - offset;
      const needPcr = first && withPcr;
      const minAdaptation = needPcr ? 8 : 0; // 1 length byte + 1 flags byte + 6 PCR bytes
      const maxPayloadWithMinAdapt = 184 - minAdaptation;

      if (remaining < maxPayloadWithMinAdapt || needPcr) {
        const payloadToTake = Math.min(remaining, maxPayloadWithMinAdapt);
        const totalAdaptBytes = 184 - payloadToTake;
        pkt[3] = 0x30 | nextCc(pid); // adaptation + payload
        const adaptFieldLen = totalAdaptBytes - 1;
        pkt[4] = adaptFieldLen;
        if (adaptFieldLen >= 1) {
          if (needPcr && adaptFieldLen >= 7) {
            pkt[5] = 0x50; // random_access_indicator (0x40) + PCR_flag (0x10)
            const pcrBase = Math.max(0, Math.floor(dts90k));
            pkt[6] = (pcrBase / 33554432) & 0xff;
            pkt[7] = (pcrBase >>> 17) & 0xff;
            pkt[8] = (pcrBase >>> 9) & 0xff;
            pkt[9] = (pcrBase >>> 1) & 0xff;
            pkt[10] = ((pcrBase & 1) << 7) | 0x7e;
            pkt[11] = 0x00;
          } else {
            pkt[5] = first ? 0x40 : 0x00;
          }
        }
        const payloadPos = 4 + totalAdaptBytes;
        pkt.set(fullPes.subarray(offset, offset + payloadToTake), payloadPos);
        offset += payloadToTake;
      } else {
        pkt[3] = 0x10 | nextCc(pid); // payload only
        pkt.set(fullPes.subarray(offset, offset + 184), 4);
        offset += 184;
      }

      tsPackets.push(pkt);
      first = false;
    }
  };

  // Build PAT (PID 0x0000 -> Program 1 -> PMT PID 0x1000)
  const patBody = new Uint8Array([
    0x00, 0xb0, 0x0d, 0x00, 0x01, 0xc1, 0x00, 0x00,
    0x00, 0x01, 0xf0, 0x00
  ]);
  const patCrc = mpeg2Crc32(patBody);
  const patSection = new Uint8Array(patBody.byteLength + 4);
  patSection.set(patBody, 0);
  new DataView(patSection.buffer).setUint32(patBody.byteLength, patCrc, false);
  emitSectionPacket(0x0000, patSection);

  // Build PMT (PID 0x1000)
  const videoTrack = doc.tracks.find((t) => t.type === "video");
  const audioTrack = doc.tracks.find((t) => t.type === "audio");
  const videoPid = 0x0100;
  const audioPid = 0x0101;
  const pcrPid = videoTrack ? videoPid : audioPid;

  const streamEntries: Uint8Array[] = [];
  if (videoTrack) {
    streamEntries.push(
      new Uint8Array([0x1b, 0xe0 | ((videoPid >>> 8) & 0x1f), videoPid & 0xff, 0xf0, 0x00])
    );
  }
  if (audioTrack) {
    streamEntries.push(
      new Uint8Array([0x0f, 0xe0 | ((audioPid >>> 8) & 0x1f), audioPid & 0xff, 0xf0, 0x00])
    );
  }
  const streamsBytes = concatBytes(streamEntries);
  const pmtSecLen = 9 + streamsBytes.byteLength + 4;
  const pmtHeader = new Uint8Array([
    0x02,
    0xb0 | ((pmtSecLen >>> 8) & 0x0f),
    pmtSecLen & 0xff,
    0x00, 0x01,
    0xc1,
    0x00, 0x00,
    0xe0 | ((pcrPid >>> 8) & 0x1f),
    pcrPid & 0xff,
    0xf0, 0x00
  ]);
  const pmtWithoutCrc = concatBytes([pmtHeader, streamsBytes]);
  const pmtCrc = mpeg2Crc32(pmtWithoutCrc);
  const pmtSection = new Uint8Array(pmtWithoutCrc.byteLength + 4);
  pmtSection.set(pmtWithoutCrc, 0);
  new DataView(pmtSection.buffer).setUint32(pmtWithoutCrc.byteLength, pmtCrc, false);
  emitSectionPacket(0x1000, pmtSection);

  // Emit video packets
  if (videoTrack) {
    const ts = videoTrack.timescale || 90000;
    const desc = videoTrack.codecDescriptions[0];
    const width = videoTrack.width ?? desc?.width ?? 320;
    const height = videoTrack.height ?? desc?.height ?? 240;
    const { sps: defaultSps, pps: defaultPps } = buildH264SpsPps(width, height, 30);
    const spsList = desc?.avcC?.sps.length ? desc.avcC.sps : [defaultSps];
    const ppsList = desc?.avcC?.pps.length ? desc.avcC.pps : [defaultPps];
    const lengthSize = (desc?.avcC?.lengthSizeMinusOne ?? 3) + 1;

    let samples = videoTrack.samples;
    if (samples.length === 0 && videoTrack.decodedVideoFrames?.length) {
      samples = videoTrack.decodedVideoFrames.map((vf, idx) => {
        const encoded = encodeH264IdrFrame(vf.data, width, height, idx);
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

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]!;
      const pts90k = Math.round((s.pts / ts) * 90000);
      const dts90k = Math.round((s.dts / ts) * 90000);
      const audNalu = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x09, 0xf0]);
      const annexB = avccToAnnexB(
        s.data,
        lengthSize,
        s.isKeyframe || i === 0 ? { sps: spsList, pps: ppsList } : undefined
      );
      emitPesPackets(
        videoPid,
        0xe0,
        pts90k,
        dts90k,
        concatBytes([audNalu, annexB]),
        s.isKeyframe || i === 0
      );
    }
  }

  // Emit audio packets
  if (audioTrack) {
    const ts = audioTrack.timescale || 44100;
    const desc = audioTrack.codecDescriptions[0];
    const sampleRate = desc?.sampleRate ?? ts;
    const channels = desc?.channels ?? 2;
    let samples = audioTrack.samples;

    if (samples.length === 0) {
      const rawAac = createSilentAacFrame(channels);
      samples = [
        {
          data: rawAac,
          dts: 0,
          pts: 0,
          cts: 0,
          duration: 1024,
          size: rawAac.byteLength,
          isKeyframe: true,
          sampleDescriptionIndex: 1
        }
      ];
    }

    for (const s of samples) {
      const pts90k = Math.round((s.pts / ts) * 90000);
      const adtsFrame =
        s.data.byteLength >= 7 && s.data[0] === 0xff && (s.data[1]! & 0xf0) === 0xf0
          ? s.data
          : wrapAdtsFrame(s.data, sampleRate, channels);
      emitPesPackets(audioPid, 0xc0, pts90k, pts90k, adtsFrame, !videoTrack);
    }
  }

  return concatBytes(tsPackets);
}

export function probeMpegTs(
  bytes: Uint8Array,
  options: ParseMediaOptions & { showPackets?: boolean; showFrames?: boolean } = {}
): MediaProbeResult {
  const doc = parseMpegTs(bytes, options);
  return buildProbeResultFromDoc(doc, bytes.byteLength, options.filename ?? "input.ts", {
    ...options,
    formatName: "mpegts",
    formatLongName: "MPEG-TS (MPEG-2 Transport Stream)"
  });
}

export function mpegtsAst(): MediaAstPlugin {
  return {
    id: "mpegts",
    formatName: "mpegts",
    formatLongName: "MPEG-TS (MPEG-2 Transport Stream)",
    extensions: ["ts", "m2ts", "mts"],
    mimeTypes: ["video/mp2t"],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: ["h264", "hevc", "mpeg2video"],
    supportedAudioCodecs: ["aac", "mp3", "ac3"],
    detect(bytes, filename) {
      if (isMpegTsSignature(bytes)) return true;
      if (filename) {
        const ext = filename.split(".").pop()?.toLowerCase() ?? "";
        if ((ext === "ts" || ext === "m2ts" || ext === "mts") && bytes.byteLength >= 188 && bytes[0] === 0x47) {
          return true;
        }
      }
      return false;
    },
    parse(bytes, options) {
      return parseMpegTs(bytes, options);
    },
    serialize(doc, options) {
      return serializeMpegTs(doc, options);
    },
    probe(bytes, options) {
      return probeMpegTs(bytes, options);
    },
    concat(docs, options) {
      return concatMp4(docs, options);
    },
    slice(doc, options) {
      return sliceMp4(doc, options);
    }
  };
}
