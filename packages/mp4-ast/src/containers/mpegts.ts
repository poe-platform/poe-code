import { serializeLatmPackets } from "./latm.js";
import { decodeH264Samples } from "../h264.js";
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
  type TsProgram,
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

export function parseMpegTs(bytes: Uint8Array, options: ParseMediaOptions = {}): MediaDocument & {
  programs: TsProgram[];
  services: Map<number, Record<string, string>>;
} {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.byteLength);

  if (!isMpegTsSignature(bytes)) {
    throw new Error("Invalid MPEG-TS stream: missing 0x47 sync byte");
  }

  const stride = bytes[0] === 0x47 ? 188 : 192;
  const pktOffset = stride === 192 ? 4 : 0;

  const programs = new Map<number, TsProgram>();
  const services = new Map<number, Record<string, string>>();
  let sdtSection: Uint8Array = new Uint8Array(0);
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
            if (!programs.has(progNum)) programs.set(progNum, {
              programNumber: progNum, pmtPid: pPid, pcrPid: 0x1fff, streamPids: []
            });
          }
        }
      }
      continue;
    }

    if ([...programs.values()].some(program => program.pmtPid === pid)) {
      // PMT
      const ptr = payloadUnitStart ? (payload[0] ?? 0) + 1 : 0;
      const section = payload.subarray(ptr);
      if (section.byteLength >= 16 && section[0] === 0x02) {
        const sectionLen = ((section[1]! & 0x0f) << 8) | section[2]!;
        const program = programs.get((section[3]! << 8) | section[4]!);
        if (!program || program.pmtPid !== pid) continue;
        program.pcrPid = ((section[8]! & 0x1f) << 8) | section[9]!;
        program.streamPids = [];
        const progInfoLen = ((section[10]! & 0x0f) << 8) | section[11]!;
        const streamsEnd = Math.min(section.byteLength, 3 + sectionLen - 4);
        let sPos = 12 + progInfoLen;
        while (sPos + 5 <= streamsEnd) {
          const streamType = section[sPos]!;
          const elemPid = ((section[sPos + 1]! & 0x1f) << 8) | section[sPos + 2]!;
          const esInfoLen = ((section[sPos + 3]! & 0x0f) << 8) | section[sPos + 4]!;
          pidStreamTypes.set(elemPid, streamType);
          program.streamPids.push(elemPid);
          sPos += 5 + esInfoLen;
        }
      }
      continue;
    }

    if (pid === 0x11) {
      if (payloadUnitStart) sdtSection = payload.subarray(1 + (payload[0] ?? 0));
      else if (sdtSection.length) sdtSection = concatBytes([sdtSection, payload]);
      if (sdtSection.length < 3) continue;
      const sectionLength = 3 + (((sdtSection[1]! & 15) << 8) | sdtSection[2]!);
      if (sdtSection.length < sectionLength) continue;
      const section = sdtSection.subarray(0, sectionLength);
      sdtSection = new Uint8Array(0);
      if (section.length >= 15 && section[0] === 0x42) {
        const end = Math.min(section.length, 3 + (((section[1]! & 15) << 8) | section[2]!) - 4);
        for (let i = 11; i + 5 <= end;) {
          const serviceId = (section[i]! << 8) | section[i + 1]!;
          const descriptorEnd = i + 5 + (((section[i + 3]! & 15) << 8) | section[i + 4]!);
          if (descriptorEnd > end) break;
          for (let d = i + 5; d + 2 <= descriptorEnd;) {
            const next = d + 2 + section[d + 1]!;
            if (next > descriptorEnd) break;
            if (section[d] === 0x48 && d + 5 <= next) {
              const providerStart = d + 4, providerEnd = providerStart + section[d + 3]!;
              const nameEnd = providerEnd + 1 + (section[providerEnd] ?? 0);
              if (providerEnd < next && nameEnd <= next) services.set(serviceId, {
                service_name: new TextDecoder().decode(section.subarray(providerEnd + (section[providerEnd + 1] === 0x15 ? 2 : 1), nameEnd)),
                service_provider: new TextDecoder().decode(section.subarray(providerStart + (section[providerStart] === 0x15 ? 1 : 0), providerEnd))
              });
            }
            d = next;
          }
          i = descriptorEnd;
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
          : dts + (samples.at(-1)?.duration ?? Math.round(90000 / (allSps[0] ? parseH264Sps(allSps[0]).fps ?? 30 : 30)));
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
        decodedVideoFrames = [...decodeH264Samples(samples, [{ formatFourCC: "avc1", codecName: "h264", avcC }], width, height, 90000)];
      }

      tracks.push({
        id: pid,
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
        id: pid,
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
    programs: [...programs.values()],
    services,
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
  const serviceId = options.mpegtsServiceId ?? 1;
  if (!Number.isInteger(serviceId) || serviceId < 1 || serviceId > 65535) {
    throw new Error("Invalid mpegts_service_id: expected an integer from 1 to 65535");
  }
  const muxRate = options.muxRate ?? 1;
  if (!Number.isInteger(muxRate) || muxRate < 0 || muxRate > 2147483647) {
    throw new Error("Invalid muxrate: expected an integer from 0 to 2147483647 bits/s");
  }
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  const muxDelay = options.muxDelay ?? 0.7;
  if (!Number.isFinite(muxDelay) || muxDelay < 0 || muxDelay > 2147.483647) {
    throw new Error("Invalid muxdelay: expected seconds from 0 to 2147.483647");
  }
  const delay90k = Math.round(Math.trunc(muxDelay * 1_000_000) * 90000 / 1_000_000);
  const startPid = options.mpegtsStartPid ?? 0x0100;
  if (!Number.isInteger(startPid) || startPid < 0x0020 || startPid > 0x1ffa) {
    throw new Error("Invalid mpegts_start_pid: expected an integer from 32 through 8186");
  }
  const videoTrack = doc.tracks.find((t) => t.type === "video");
  const tracks = doc.tracks.filter((t) => t === videoTrack || t.type === "audio"
    || (t.type === "subtitle" && t.codecDescriptions[0]?.codecName === "subrip"));
  if (tracks.some((_, index) => startPid + index === 0x1000)) {
    throw new Error("MPEG-TS elementary PID conflicts with PMT PID 4096");
  }
  const videoPid = startPid + (videoTrack ? tracks.indexOf(videoTrack) : 0);
  const pcrPid = videoTrack ? videoPid : startPid;
  const patPeriod = options.patPeriod ?? 0.1;
  if (!Number.isFinite(patPeriod) || patPeriod < 0) {
    throw new Error("Invalid pat_period: expected nonnegative seconds");
  }
  const patPeriod90k = Math.round(patPeriod * 90000);
  let lastPatDts: number | undefined;
  const tsPackets: Uint8Array[] = [];
  const ccByPid = new Map<number, number>();
  let clockOrigin90k = 0;
  let lastPcrPacket = -Infinity;
  const pcrInterval = Math.max(1, Math.ceil(muxRate * 0.02 / (188 * 8)));

  const appendPacket = (packet: Uint8Array) => {
    budget.checkCpu();
    budget.checkOutputBytes((tsPackets.length + 1) * 188);
    budget.allocateMemory(188);
    tsPackets.push(packet);
  };

  const writePcr = (packet: Uint8Array, dts90k: number) => {
    const ticks = muxRate > 1
      ? clockOrigin90k * 300 + Math.floor((tsPackets.length * 188 + 11) * 8 * 27000000 / muxRate)
      : (dts90k - delay90k) * 300;
    const wrapped = ((ticks % (2 ** 33 * 300)) + 2 ** 33 * 300) % (2 ** 33 * 300);
    const base = Math.floor(wrapped / 300);
    const extension = wrapped % 300;
    packet[6] = (base / 33554432) & 0xff;
    packet[7] = (base >>> 17) & 0xff;
    packet[8] = (base >>> 9) & 0xff;
    packet[9] = (base >>> 1) & 0xff;
    packet[10] = ((base & 1) << 7) | 0x7e | (extension >>> 8);
    packet[11] = extension & 0xff;
    lastPcrPacket = tsPackets.length;
  };

  const emitPcrPacket = () => {
    const packet = new Uint8Array(188).fill(0xff);
    packet[0] = 0x47;
    packet[1] = (pcrPid >>> 8) & 0x1f;
    packet[2] = pcrPid & 0xff;
    // Adaptation-only packets retain the last payload continuity counter.
    packet[3] = 0x20 | (((ccByPid.get(pcrPid) ?? 1) - 1) & 15);
    packet[4] = 183;
    packet[5] = 0x10;
    writePcr(packet, 0);
    appendPacket(packet);
  };
  const discontinuityPids = new Set<number>();

  const nextCc = (pid: number): number => {
    const cc = ccByPid.get(pid) ?? 0;
    ccByPid.set(pid, (cc + 1) & 0x0f);
    return cc;
  };

  const emitSectionPacket = (pid: number, section: Uint8Array) => {
    if (muxRate > 1 && Number.isFinite(lastPcrPacket)
        && tsPackets.length - lastPcrPacket >= pcrInterval) emitPcrPacket();
    for (let offset = 0; offset < section.byteLength;) {
      const first = offset === 0;
      const pkt = new Uint8Array(188).fill(0xff);
      pkt[0] = 0x47;
      pkt[1] = (first ? 0x40 : 0) | ((pid >>> 8) & 0x1f);
      pkt[2] = pid & 0xff;
      const discontinuity = options.initialDiscontinuity && !discontinuityPids.has(pid);
      pkt[3] = (discontinuity ? 0x30 : 0x10) | nextCc(pid);
      let start = 4;
      if (discontinuity) {
        pkt[start++] = 1; // adaptation_field_length
        pkt[start++] = 0x80; // discontinuity_indicator
        discontinuityPids.add(pid);
      }
      if (first) pkt[start++] = 0; // pointer_field
      const size = Math.min(188 - start, section.byteLength - offset);
      pkt.set(section.subarray(offset, offset + size), start);
      appendPacket(pkt);
      offset += size;
    }
  };

  const emitPesPackets = (
    pid: number,
    streamId: number,
    pts90k: number,
    dts90k: number,
    esPayload: Uint8Array,
    withPcr: boolean,
    isKeyframe: boolean
  ) => {
    // FFmpeg leaves two mux delays before presentation, with PCR one delay behind DTS.
    pts90k += 2 * delay90k;
    dts90k += 2 * delay90k;
    if (muxRate > 1) {
      const targetPackets = Math.ceil((dts90k - delay90k - clockOrigin90k) * muxRate / (90000 * 188 * 8));
      budget.checkOutputBytes(targetPackets * 188);
      while (tsPackets.length < targetPackets) {
        if (tsPackets.length - lastPcrPacket >= pcrInterval) {
          emitPcrPacket();
        } else {
          const packet = new Uint8Array(188).fill(0xff);
          packet.set([0x47, 0x1f, 0xff, 0x10]);
          appendPacket(packet);
        }
      }
    }
    const hasDts = Math.abs(pts90k - dts90k) > 0;
    const headerDataLen = hasDts ? 10 : 5;
    const pesHeader = new BinaryWriter(9 + headerDataLen);
    pesHeader.writeU8(0x00);
    pesHeader.writeU8(0x00);
    pesHeader.writeU8(0x01);
    pesHeader.writeU8(streamId);
    const pesLen = 3 + headerDataLen + esPayload.byteLength;
    const omitLength = (streamId & 0xf0) === 0xe0 && (options.omitVideoPesLength ?? true);
    pesHeader.writeU16BE(!omitLength && pesLen <= 0xffff ? pesLen : 0);
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
      if (lastPatDts === undefined) {
        lastPatDts = dts90k;
      } else if ((first && videoTrack && pid === videoPid && options.patPmtAtFrames) || dts90k - lastPatDts >= patPeriod90k) {
        emitSectionPacket(0x0000, patSection);
        emitSectionPacket(0x1000, pmtSection);
        lastPatDts = dts90k;
      }
      if (muxRate > 1 && pid !== pcrPid && tsPackets.length - lastPcrPacket >= pcrInterval) emitPcrPacket();
      const pkt = new Uint8Array(188).fill(0xff);
      pkt[0] = 0x47;
      pkt[1] = (first ? 0x40 : 0x00) | ((pid >>> 8) & 0x1f);
      pkt[2] = pid & 0xff;

      const remaining = fullPes.byteLength - offset;
      const needPcr = muxRate > 1
        ? pid === pcrPid && tsPackets.length - lastPcrPacket >= pcrInterval
        : first && withPcr;
      const randomAccess = first && isKeyframe && !options.mpegtsOmitRai;
      const discontinuity = options.initialDiscontinuity && !discontinuityPids.has(pid);
      const minAdaptation = needPcr ? 8 : randomAccess || discontinuity ? 2 : 0; // 1 length byte + 1 flags byte + 6 PCR bytes
      const maxPayloadWithMinAdapt = 184 - minAdaptation;

      if (remaining < maxPayloadWithMinAdapt || minAdaptation > 0) {
        const payloadToTake = Math.min(remaining, maxPayloadWithMinAdapt);
        const totalAdaptBytes = 184 - payloadToTake;
        pkt[3] = 0x30 | nextCc(pid); // adaptation + payload
        const adaptFieldLen = totalAdaptBytes - 1;
        pkt[4] = adaptFieldLen;
        if (adaptFieldLen >= 1) {
          if (needPcr && adaptFieldLen >= 7) {
            pkt[5] = 0x10 | (randomAccess ? 0x40 : 0);
            writePcr(pkt, dts90k);
          } else {
            pkt[5] = randomAccess ? 0x40 : 0;
          }
        }
        if (discontinuity) {
          pkt[5] = pkt[5]! | 0x80;
          discontinuityPids.add(pid);
        }
        const payloadPos = 4 + totalAdaptBytes;
        pkt.set(fullPes.subarray(offset, offset + payloadToTake), payloadPos);
        offset += payloadToTake;
      } else {
        pkt[3] = 0x10 | nextCc(pid); // payload only
        pkt.set(fullPes.subarray(offset, offset + 184), 4);
        offset += 184;
      }

      appendPacket(pkt);
      first = false;
    }
  };

  const tablesVersion = options.mpegtsTablesVersion ?? 0;
  if (!Number.isInteger(tablesVersion) || tablesVersion < 0 || tablesVersion > 31) {
    throw new Error("MPEG-TS tables version must be an integer from 0 through 31");
  }
  const versionByte = 0xc1 | (tablesVersion << 1);
  const serviceType = options.mpegtsServiceType ?? 1;
  if (!Number.isInteger(serviceType) || serviceType < 1 || serviceType > 255) {
    throw new Error("MPEG-TS service type must be an integer from 1 through 255");
  }
  // SDT: transport 1, selected service/program, original network 0xff01, running service.
  const metadata = { ...doc.metadata.custom, ...options.metadata?.custom };
  const encodeServiceText = (value: string): Uint8Array => {
    const bytes = new TextEncoder().encode(value);
    // DVB strings with non-ASCII characters explicitly select UTF-8.
    return bytes.some(byte => byte >= 0x80) ? concatBytes([new Uint8Array([0x15]), bytes]) : bytes;
  };
  const provider = encodeServiceText(metadata.service_provider ?? "FFmpeg");
  const name = encodeServiceText(metadata.service_name ?? "Service01");
  const descriptorLength = 3 + provider.length + name.length;
  if (descriptorLength > 255) throw new Error("MPEG-TS service descriptor exceeds 255 bytes");
  const descriptor = concatBytes([
    new Uint8Array([0x48, descriptorLength, serviceType, provider.length]),
    provider, new Uint8Array([name.length]), name
  ]);
  const sdtLength = 17 + descriptor.length;
  const sdtBody = concatBytes([
    new Uint8Array([
      0x42, 0xf0 | (sdtLength >>> 8), sdtLength & 0xff,
      0x00, 0x01, versionByte, 0x00, 0x00, 0xff, 0x01, 0xff,
      serviceId >>> 8, serviceId & 0xff, 0xfc, 0x80 | (descriptor.length >>> 8), descriptor.length & 0xff
    ]), descriptor
  ]);
  const sdtSection = new Uint8Array(sdtBody.length + 4);
  sdtSection.set(sdtBody);
  new DataView(sdtSection.buffer).setUint32(sdtBody.length, mpeg2Crc32(sdtBody), false);
  emitSectionPacket(0x0011, sdtSection);

  // Build PAT (PID 0x0000 -> service/program -> PMT PID 0x1000)
  const patBody = new Uint8Array([
    0x00, 0xb0, 0x0d, 0x00, 0x01, versionByte, 0x00, 0x00,
    serviceId >>> 8, serviceId & 0xff, 0xf0, 0x00
  ]);
  const patCrc = mpeg2Crc32(patBody);
  const patSection = new Uint8Array(patBody.byteLength + 4);
  patSection.set(patBody, 0);
  new DataView(patSection.buffer).setUint32(patBody.byteLength, patCrc, false);
  emitSectionPacket(0x0000, patSection);

  // Build PMT (PID 0x1000)
  const streamEntries = tracks.map((track, index) => {
    const pid = startPid + index;
    const language = track.type === "audio" ? track.language : undefined;
    const languageDescriptor = language && language.length === 3
      ? new Uint8Array([0x0a, 4, language.charCodeAt(0), language.charCodeAt(1), language.charCodeAt(2), 0])
      : new Uint8Array(0);
    return concatBytes([
      new Uint8Array([
        track.type === "video" ? 0x1b : track.type === "subtitle" ? 0x06 : options.mpegtsLatm ? 0x11 : 0x0f,
        0xe0 | ((pid >>> 8) & 0x1f), pid & 0xff, 0xf0, languageDescriptor.length
      ]), languageDescriptor
    ]);
  });
  const streamsBytes = concatBytes(streamEntries);
  const pmtSecLen = 9 + streamsBytes.byteLength + 4;
  const pmtHeader = new Uint8Array([
    0x02,
    0xb0 | ((pmtSecLen >>> 8) & 0x0f),
    pmtSecLen & 0xff,
    serviceId >>> 8, serviceId & 0xff,
    versionByte,
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

  const streams: Generator<Parameters<typeof emitPesPackets>>[] = [];

  // Prepare one PES at a time per track.
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

    streams.push((function* (): Generator<Parameters<typeof emitPesPackets>> {
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
        yield [
          videoPid,
          0xe0,
          pts90k,
          dts90k,
          concatBytes([audNalu, annexB]),
          s.isKeyframe || i === 0,
          s.isKeyframe
        ];
      }
    })());
  }

  // Emit audio packets
  for (const [trackIndex, audioTrack] of tracks.entries()) {
    if (audioTrack.type !== "audio") continue;
    const pid = startPid + trackIndex;
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

    const latmPackets = options.mpegtsLatm ? serializeLatmPackets({ ...audioTrack, samples }) : undefined;
    streams.push((function* (): Generator<Parameters<typeof emitPesPackets>> {
      for (const [index, s] of samples.entries()) {
        const pts90k = Math.round((s.pts / ts) * 90000);
        const frame = latmPackets?.[index] ?? (
          s.data.byteLength >= 7 && s.data[0] === 0xff && (s.data[1]! & 0xf0) === 0xf0
            ? s.data
            : wrapAdtsFrame(s.data, sampleRate, channels));
        yield [pid, 0xc0, pts90k, pts90k, frame, pid === pcrPid, s.isKeyframe];
      }
    })());
  }

  // SubRip is private data in MPEG-TS: preserve cue bytes, without subtitle framing.
  for (const [index, track] of tracks.entries()) {
    if (track.type !== "subtitle") continue;
    const pid = startPid + index;
    const timescale = track.timescale || 1000;
    streams.push((function* (): Generator<Parameters<typeof emitPesPackets>> {
      for (const sample of track.samples) {
        yield [pid, 0xbd,
          Math.round(sample.pts * 90000 / timescale),
          Math.round(sample.dts * 90000 / timescale),
          sample.data, pid === pcrPid, sample.isKeyframe];
      }
    })());
  }

  // Merge by decode time, retaining track order and per-PID continuity.
  const pending = streams.map(stream => stream.next());
  clockOrigin90k = pending.reduce((earliest, packet) => packet.done ? earliest : Math.min(earliest, packet.value[3]), Infinity) + delay90k;
  while (true) {
    let next = -1;
    for (let i = 0; i < pending.length; i++) {
      const packet = pending[i]!;
      if (!packet.done && (next < 0 || packet.value[3] < pending[next]!.value[3])) next = i;
    }
    if (next < 0) break;
    const packet = pending[next]!;
    if (packet.done) break;
    emitPesPackets(...packet.value);
    pending[next] = streams[next]!.next();
  }

  budget.allocateMemory(tsPackets.length * 188);
  const output = concatBytes(tsPackets);
  budget.releaseMemory(tsPackets.length * 188 * 2);
  return output;
}

export function probeMpegTs(
  bytes: Uint8Array,
  options: ParseMediaOptions & { showPackets?: boolean; showFrames?: boolean } = {}
): MediaProbeResult {
  const doc = parseMpegTs(bytes, options);
  const probe = buildProbeResultFromDoc(doc, bytes.byteLength, options.filename ?? "input.ts", {
    ...options,
    formatName: "mpegts",
    formatLongName: "MPEG-TS (MPEG-2 Transport Stream)"
  });
  const streams = probe.streams.map((stream, index) => ({ ...stream, id: `0x${doc.tracks[index]!.id.toString(16)}` }));
  return { ...probe, streams, programs: doc.programs.map(program => {
    const members = streams.filter((_, index) => program.streamPids.includes(doc.tracks[index]!.id));
    return {
      program_id: program.programNumber, program_num: program.programNumber,
      nb_streams: members.length, pmt_pid: program.pmtPid, pcr_pid: program.pcrPid,
      tags: doc.services.get(program.programNumber) ?? {}, streams: members
    };
  }) };
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
