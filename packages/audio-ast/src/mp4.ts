import { Reader, cleanText, duration } from "./binary.js";
import type { AudioAst, AudioNode, AudioTags, AudioPicture, AudioStream } from "./types.js";
export const itunesNames: Record<string, string> = {
  "©nam": "title",
  "©ART": "artist",
  aART: "albumArtist",
  "©alb": "album",
  "©day": "date",
  "©gen": "genre",
  "©cmt": "comment",
  "©too": "encoder",
  cprt: "copyright",
  trkn: "track",
  disk: "disc"
};
const containers = new Set([
  "moov",
  "trak",
  "mdia",
  "minf",
  "stbl",
  "udta",
  "meta",
  "ilst",
  "edts",
  "dinf"
]);
export function readAtoms(
  r: Reader,
  start = 0,
  end = r.bytes.length,
  depth = 0,
  parent = ""
): AudioNode[] {
  if (depth > 32) throw new Error("MP4 atom nesting too deep");
  const nodes: AudioNode[] = [];
  for (let offset = start; offset < end; ) {
    const short = r.u32(offset),
      type = r.text(offset + 4, 4);
    let header = 8,
      size = short;
    if (short === 1) {
      size = r.safe64(offset + 8);
      header = 16;
    } else if (!short) size = end - offset;
    if (type === "uuid") header += 16;
    if (size < header || size > end - offset) throw new Error("Invalid MP4 atom bounds");
    const data = r.slice(offset + header, size - header),
      node: AudioNode = { type, offset, size, data, fields: { headerSize: header } };
    nodes.push(node);
    if (containers.has(type) || parent === "ilst") {
      const prefix = type === "meta" ? 4 : 0;
      if (data.length < prefix) throw new Error("Short MP4 meta");
      node.children = readAtoms(r, offset + header + prefix, offset + size, depth + 1, type);
    }
    offset += size;
  }
  return nodes;
}
export function descend(nodes: AudioNode[], type: string): AudioNode[] {
  return nodes.flatMap((n) => [
    ...(n.type === type ? [n] : []),
    ...descend(n.children ?? [], type)
  ]);
}
function timing(node: AudioNode): { timescale: number; duration: number } {
  const r = new Reader(node.data),
    version = r.u8(0);
  if (version !== 0 && version !== 1) throw new Error("Unsupported MP4 timing version");
  const offset = version === 1 ? 20 : 12,
    timescale = r.u32(offset),
    units = version === 1 ? r.safe64(offset + 4) : r.u32(offset + 4);
  return { timescale, duration: duration(units, timescale) };
}
export function parseMp4(bytes: Uint8Array): AudioAst {
  const r = new Reader(bytes),
    nodes = readAtoms(r),
    tags: AudioTags = {},
    pictures: AudioPicture[] = [],
    streams: AudioStream[] = [];
  const ftyp = nodes.find((n) => n.type === "ftyp"),
    moov = nodes.find((n) => n.type === "moov");
  if (!ftyp || ftyp.data.length < 8 || !moov) throw new Error("MP4 requires ftyp and moov");
  ftyp.fields = {
    ...ftyp.fields,
    majorBrand: new Reader(ftyp.data).text(0, 4),
    minorVersion: new Reader(ftyp.data).u32(4),
    compatibleBrands: Array.from({ length: Math.floor((ftyp.data.length - 8) / 4) }, (_, i) =>
      new Reader(ftyp.data).text(8 + i * 4, 4)
    )
  };
  const mvhd = descend([moov], "mvhd")[0],
    movieTime = mvhd ? timing(mvhd) : undefined;
  const movieDuration = movieTime?.duration ?? 0;
  if (mvhd) mvhd.fields = { ...mvhd.fields, ...movieTime };
  for (const track of moov.children?.filter((n) => n.type === "trak") ?? []) {
    const stsd = descend([track], "stsd")[0],
      mdhd = descend([track], "mdhd")[0];
    if (!stsd || !mdhd) continue;
    const handler = descend([track], "hdlr")[0];
    if (handler && new Reader(handler.data).text(8, 4) !== "soun") continue;
    const sr = new Reader(stsd.data),
      count = sr.u32(4),
      entries = readAtoms(
        r,
        stsd.offset + Number(stsd.fields!.headerSize) + 8,
        stsd.offset + stsd.size
      );
    stsd.children = entries;
    if (entries.length !== count) throw new Error("MP4 sample description count mismatch");
    const audio = entries.find((n) => ["mp4a", "alac", "Opus"].includes(n.type));
    if (!audio) continue;
    const sample = new Reader(audio.data),
      version = sample.u16(8);
    let channels = sample.u16(16),
      bitsPerSample = sample.u16(18),
      sampleRate = sample.u32(24) >>> 16;
    let prefix = 28;
    if (version === 1) prefix = 44;
    else if (version === 2) {
      sample.check(28, 36);
      sampleRate = sample.view.getFloat64(32);
      channels = sample.u32(40);
      bitsPerSample = sample.u32(48);
      prefix = 64;
    } else if (version !== 0) throw new Error("Unsupported MP4 audio sample version");
    sample.check(0, prefix);
    audio.children = readAtoms(
      r,
      audio.offset + Number(audio.fields!.headerSize) + prefix,
      audio.offset + audio.size
    );
    const alac = audio.children.find((n) => n.type === "alac");
    if (alac) {
      const config = new Reader(alac.data);
      config.check(0, 28);
      bitsPerSample = config.u8(9);
      channels = config.u8(13);
      sampleRate = config.u32(24);
    }
    const opus = audio.children.find((n) => n.type === "dOps");
    if (opus) {
      const config = new Reader(opus.data);
      config.check(0, 11);
      channels = config.u8(1);
      sampleRate = 48000;
    }
    if (!channels || !sampleRate) throw new Error("Invalid MP4 audio sample layout");
    const time = timing(mdhd),
      codec = audio.type === "mp4a" ? "aac" : audio.type.toLowerCase();
    let presentation = time.duration;
    const elst = descend([track], "elst")[0];
    if (elst && movieTime) {
      const edits = new Reader(elst.data),
        version = edits.u8(0),
        count = edits.u32(4),
        width = version === 1 ? 20 : 12;
      if (version !== 0 && version !== 1) throw new Error("Unsupported MP4 edit list version");
      edits.check(8, count * width);
      presentation = 0;
      const entries = [];
      for (let i = 0; i < count; i++) {
        const pos = 8 + i * width,
          segment = version === 1 ? edits.safe64(pos) : edits.u32(pos),
          mediaTime =
            version === 1 ? edits.view.getBigInt64(pos + 8) : BigInt(edits.view.getInt32(pos + 4));
        const rate = edits.u16(pos + width - 4) + edits.u16(pos + width - 2) / 65536;
        presentation += segment / movieTime.timescale;
        entries.push({ segmentDuration: segment, mediaTime, rate });
      }
      elst.fields = { ...elst.fields, entries };
    }
    const samples = Math.round(presentation * sampleRate);
    streams.push({
      codec,
      sampleRate,
      channels,
      bitsPerSample,
      samples,
      duration: presentation,
      bitrate: 0
    });
    audio.fields = { ...audio.fields, codec, sampleRate, channels, bitsPerSample };
    mdhd.fields = { ...mdhd.fields, ...time };
    const stsz = descend([track], "stsz")[0];
    if (stsz) {
      const sizes = new Reader(stsz.data),
        fixed = sizes.u32(4),
        number = sizes.u32(8);
      let total = fixed * number;
      if (!fixed) {
        sizes.check(12, number * 4);
        for (let i = 0; i < number; i++) total += sizes.u32(12 + i * 4);
      }
      streams[streams.length - 1]!.bitrate = time.duration ? (total * 8) / time.duration : 0;
    }
  }
  for (const ilst of descend([moov], "ilst"))
    for (const entry of ilst.children ?? [])
      for (const item of entry.children ?? []) {
        if (item.type !== "data" || entry.type === "----") continue;
        const data = new Reader(item.data),
          kind = data.u32(0) & 0xffffff,
          payload = data.slice(8, item.data.length - 8);
        if (entry.type === "covr")
          pictures.push({
            type: 3,
            mime: kind === 14 ? "image/png" : "image/jpeg",
            description: "",
            data: payload
          });
        else if (entry.type === "trkn" || entry.type === "disk") {
          const p = new Reader(payload),
            number = p.u16(2),
            total = p.u16(4);
          tags[itunesNames[entry.type]!] = total ? `${number}/${total}` : String(number);
        } else if (kind === 1)
          tags[itunesNames[entry.type] ?? entry.type] = cleanText(
            new TextDecoder().decode(payload)
          );
      }
  if (!streams.length) throw new Error("MP4 has no supported audio stream");
  const seconds = movieDuration || Math.max(...streams.map((s) => s.duration));
  return {
    format: "m4a",
    data: bytes,
    nodes,
    streams,
    tags,
    pictures,
    duration: seconds,
    bitrate: seconds ? (bytes.length * 8) / seconds : 0
  };
}
