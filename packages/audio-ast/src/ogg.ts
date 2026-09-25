import { Reader, ascii, join } from "./binary.js";
import { parseComments, parsePicture } from "./vorbis.js";
import type { AudioAst, AudioNode, AudioStream, AudioTags, AudioPicture } from "./types.js";

export function oggCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= (i >= 22 && i < 26 ? 0 : bytes[i]!) << 24;
    for (let bit = 0; bit < 8; bit++) crc = (crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0);
  }
  return crc >>> 0;
}
export interface OggPacket {
  data: Uint8Array;
  serial: number;
  granule: bigint;
  bos: boolean;
  eos: boolean;
}
interface Logical {
  packets: OggPacket[];
  pending: Uint8Array[];
  sequence: number;
  ended: boolean;
}
export function readOgg(bytes: Uint8Array): { nodes: AudioNode[]; packets: OggPacket[] } {
  const r = new Reader(bytes),
    nodes: AudioNode[] = [],
    packets: OggPacket[] = [],
    logical = new Map<number, Logical>();
  for (let offset = 0; offset < bytes.length; ) {
    if (r.text(offset, 4) !== "OggS" || r.u8(offset + 4) !== 0) throw new Error("Invalid Ogg page");
    const flags = r.u8(offset + 5),
      granule = r.u64(offset + 6, true),
      serial = r.u32(offset + 14, true),
      sequence = r.u32(offset + 18, true),
      count = r.u8(offset + 26),
      laces = r.slice(offset + 27, count);
    if (flags & ~7) throw new Error("Invalid Ogg page flags");
    const size = 27 + count + laces.reduce((sum, n) => sum + n, 0),
      page = r.slice(offset, size);
    if (oggCrc(page) !== r.u32(offset + 22, true)) throw new Error("Ogg checksum mismatch");
    let state = logical.get(serial);
    if (!state) {
      if (!(flags & 2) || sequence !== 0) throw new Error("Missing Ogg beginning-of-stream");
      state = { packets: [], pending: [], sequence: -1, ended: false };
      logical.set(serial, state);
    }
    if (
      state.ended ||
      sequence !== (state.sequence + 1) >>> 0 ||
      !!(flags & 1) !== !!state.pending.length
    )
      throw new Error("Invalid Ogg sequence/continuation");
    state.sequence = sequence;
    const completed: OggPacket[] = [];
    let pos = offset + 27 + count;
    for (const lace of laces) {
      state.pending.push(r.slice(pos, lace));
      pos += lace;
      if (lace < 255) {
        const packet: OggPacket = {
          data: join(state.pending),
          serial,
          granule: 0xffffffffffffffffn,
          bos: state.packets.length === 0,
          eos: false
        };
        state.pending = [];
        state.packets.push(packet);
        packets.push(packet);
        completed.push(packet);
      }
    }
    if (completed.length) {
      completed[completed.length - 1]!.granule = granule;
      if (flags & 4) completed[completed.length - 1]!.eos = true;
    }
    if (flags & 4) {
      if (state.pending.length) throw new Error("Incomplete final Ogg packet");
      state.ended = true;
    }
    nodes.push({
      type: "OggS",
      offset,
      size,
      data: page,
      fields: {
        flags,
        granule,
        serial,
        sequence,
        checksum: r.u32(offset + 22, true),
        lacing: laces
      }
    });
    offset += size;
  }
  if (!logical.size || Array.from(logical.values()).some((s) => s.pending.length || !s.ended))
    throw new Error("Incomplete Ogg stream");
  return { nodes, packets };
}
export function encodeOgg(packets: OggPacket[]): Uint8Array {
  const pages: Uint8Array[] = [],
    sequences = new Map<number, number>(),
    pending = new Map<number, OggPacket[]>();
  for (const packet of packets) {
    const group = pending.get(packet.serial) ?? [];
    group.push(packet);
    pending.set(packet.serial, group);
    if (packet.granule === 0xffffffffffffffffn && !packet.eos) continue;
    const laces: number[] = [],
      granules: bigint[] = [],
      boundaries = new Set<number>();
    for (const item of group) {
      for (let j = 0; j < Math.floor(item.data.length / 255); j++) {
        laces.push(255);
        granules.push(0xffffffffffffffffn);
      }
      laces.push(item.data.length % 255);
      granules.push(item.granule);
      boundaries.add(laces.length);
    }
    const body = join(group.map((p) => p.data));
    let offset = 0;
    for (let start = 0; start < laces.length; start += 255) {
      const part = laces.slice(start, start + 255),
        last = start + 255 >= laces.length,
        size = part.reduce((a, b) => a + b, 0),
        header = new Uint8Array(27 + part.length),
        v = new DataView(header.buffer);
      header.set(ascii("OggS"));
      header[5] =
        (start && !boundaries.has(start) ? 1 : 0) |
        (group[0]!.bos && start === 0 ? 2 : 0) |
        (packet.eos && last ? 4 : 0);
      let granule = 0xffffffffffffffffn;
      for (let i = start; i < start + part.length; i++)
        if (laces[i]! < 255) granule = granules[i] === 0xffffffffffffffffn ? 0n : granules[i]!;
      v.setBigUint64(6, granule, true);
      v.setUint32(14, packet.serial, true);
      const sequence = sequences.get(packet.serial) ?? 0;
      v.setUint32(18, sequence, true);
      sequences.set(packet.serial, sequence + 1);
      header[26] = part.length;
      header.set(part, 27);
      const page = join([header, body.subarray(offset, offset + size)]);
      new DataView(page.buffer).setUint32(22, oggCrc(page), true);
      pages.push(page);
      offset += size;
    }
    pending.delete(packet.serial);
  }
  if (pending.size) throw new Error("Ogg packets lack a final page granule");
  return join(pages);
}
export function parseOgg(bytes: Uint8Array): AudioAst {
  const { nodes, packets } = readOgg(bytes),
    streams: AudioStream[] = [],
    tags: AudioTags = {},
    pictures: AudioPicture[] = [];
  const serials = [...new Set(packets.map((p) => p.serial))];
  for (const serial of serials) {
    const group = packets.filter((p) => p.serial === serial),
      head = group[0]!.data,
      r = new Reader(head);
    let codec: string,
      sampleRate: number,
      channels: number,
      preSkip = 0;
    if (head.length >= 8 && r.text(0, 8) === "OpusHead") {
      if (head.length < 19 || r.u8(8) > 15) throw new Error("Invalid Opus identification");
      codec = "opus";
      sampleRate = 48000;
      channels = r.u8(9);
      preSkip = r.u16(10, true);
      const mapping = r.u8(18);
      if (mapping === 0 && channels > 2) throw new Error("Invalid Opus channels");
      if (mapping !== 0) r.check(19, 2 + channels);
      const comment = group[1]?.data;
      if (!comment || new Reader(comment).text(0, 8) !== "OpusTags")
        throw new Error("Missing OpusTags");
      Object.assign(tags, parseComments(comment.subarray(8)).tags);
    } else if (head.length >= 7 && r.u8(0) === 1 && r.text(1, 6) === "vorbis") {
      if (head.length !== 30 || r.u32(7, true) !== 0 || !(r.u8(29) & 1))
        throw new Error("Invalid Vorbis identification");
      codec = "vorbis";
      channels = r.u8(11);
      sampleRate = r.u32(12, true);
      const comment = group[1]?.data;
      if (!comment || comment[0] !== 3 || new Reader(comment).text(1, 6) !== "vorbis")
        throw new Error("Missing Vorbis comments");
      const parsed = parseComments(comment.subarray(7));
      if (!(comment[7 + parsed.size]! & 1)) throw new Error("Missing Vorbis comment framing bit");
      Object.assign(tags, parsed.tags);
    } else throw new Error("Unsupported Ogg codec");
    if (!channels || !sampleRate) throw new Error("Invalid Ogg audio stream");
    const final = group.filter((p) => p.granule !== 0xffffffffffffffffn).at(-1)?.granule ?? 0n;
    if (final > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("Ogg granule exceeds safe precision");
    const samples = Math.max(0, Number(final) - preSkip),
      duration = samples / sampleRate;
    const size = nodes
      .filter((n) => n.fields?.serial === serial)
      .reduce((sum, n) => sum + n.size, 0);
    streams.push({
      codec,
      sampleRate,
      channels,
      samples,
      duration,
      bitrate: duration ? (size * 8) / duration : 0
    });
  }
  for (const value of (tags.METADATA_BLOCK_PICTURE ?? "").split("\n").filter(Boolean)) {
    pictures.push(parsePicture(Uint8Array.from(atob(value), (c) => c.charCodeAt(0))));
  }
  // A new chain starts only after every logical stream in the previous group ends.
  let duration = 0,
    groupDuration = 0;
  const active = new Set<number>();
  for (const node of nodes) {
    const serial = node.fields!.serial as number,
      flags = node.fields!.flags as number;
    if (flags & 2) {
      if (!active.size) {
        duration += groupDuration;
        groupDuration = 0;
      }
      active.add(serial);
      groupDuration = Math.max(groupDuration, streams[serials.indexOf(serial)]!.duration);
    }
    if (flags & 4) active.delete(serial);
  }
  duration += groupDuration;
  return {
    format: "ogg",
    data: bytes,
    nodes,
    streams,
    tags,
    pictures,
    duration,
    bitrate: duration ? (bytes.length * 8) / duration : 0
  };
}
