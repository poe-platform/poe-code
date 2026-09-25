import { Reader, ascii, join, uint32 } from "./binary.js";
import { encodeId3 } from "./id3.js";
import { encodeComments, encodePicture, parseComments, pictureBase64 } from "./vorbis.js";
import { encodeOgg, readOgg } from "./ogg.js";
import { descend, itunesNames } from "./mp4.js";
import { riffChunk, wavInfo } from "./wav.js";
import type { AudioAst, AudioNode, AudioPicture, AudioTags } from "./types.js";

export interface MetadataOptions {
  pictures?: AudioPicture[];
}
function atom(type: string, data: Uint8Array): Uint8Array {
  if (type.length !== 4 || data.length > 0xffffffff - 8) throw new Error("Invalid MP4 atom");
  return join([uint32(data.length + 8), ascii(type), data]);
}
function itunes(tags: AudioTags, pictures: AudioPicture[]): Uint8Array {
  const entries: Uint8Array[] = [];
  for (const [name, value] of Object.entries(tags)) {
    const id = Object.keys(itunesNames).find((key) => itunesNames[key] === name) ?? name;
    if (id.length !== 4) throw new Error(`Unsupported iTunes tag ${name}`);
    let payload: Uint8Array,
      kind = 1;
    if (id === "trkn" || id === "disk") {
      const [number, total = "0"] = value.split("/");
      if (
        !Number.isInteger(Number(number)) ||
        !Number.isInteger(Number(total)) ||
        Number(number) < 0 ||
        Number(number) > 65535 ||
        Number(total) < 0 ||
        Number(total) > 65535
      )
        throw new Error("Invalid iTunes track/disc number");
      payload = new Uint8Array(8);
      const v = new DataView(payload.buffer);
      v.setUint16(2, Number(number));
      v.setUint16(4, Number(total));
      kind = 0;
    } else payload = new TextEncoder().encode(value);
    entries.push(atom(id, atom("data", join([uint32(kind), uint32(0), payload]))));
  }
  for (const picture of pictures) {
    if (!["image/jpeg", "image/png"].includes(picture.mime))
      throw new Error("iTunes artwork requires JPEG or PNG");
    entries.push(
      atom(
        "covr",
        atom(
          "data",
          join([uint32(picture.mime === "image/png" ? 14 : 13), uint32(0), picture.data])
        )
      )
    );
  }
  return atom("ilst", join(entries));
}
function writeMp4(ast: AudioAst, tags: AudioTags, pictures: AudioPicture[]): Uint8Array {
  if (ast.nodes.some((n) => n.type === "moof") || descend(ast.nodes, "mvex").length)
    throw new Error("Fragmented MP4 metadata editing is unsupported");
  const moov = ast.nodes.find((n) => n.type === "moov")!,
    replacement = itunes(tags, pictures),
    first = descend([moov], "ilst")[0];
  function rebuild(node: AudioNode, delta: number): Uint8Array {
    if (node === first) {
      // Preserve non-text/freeform metadata not represented by the normalized tags API.
      const retained = (node.children ?? []).filter(
        (n) =>
          n.type === "----" ||
          (!itunesNames[n.type] && n.type !== "covr" && !Object.hasOwn(tags, n.type))
      );
      return atom(
        "ilst",
        join([
          replacement.subarray(8),
          ...retained.map((n) => ast.data.subarray(n.offset, n.offset + n.size))
        ])
      );
    }
    if (node.type === "stco" || node.type === "co64") {
      const data = node.data.slice(),
        r = new Reader(data),
        count = r.u32(4),
        width = node.type === "stco" ? 4 : 8;
      r.check(8, count * width);
      for (let i = 0; i < count; i++) {
        const pos = 8 + i * width,
          old = width === 4 ? r.u32(pos) : r.safe64(pos);
        const updated = old >= moov.offset + moov.size ? old + delta : old;
        if (width === 4 && updated > 0xffffffff) throw new Error("MP4 chunk offset overflow");
        if (width === 4) r.view.setUint32(pos, updated);
        else r.view.setBigUint64(pos, BigInt(updated));
      }
      return atom(node.type, data);
    }
    if (
      node.children &&
      ["moov", "trak", "mdia", "minf", "stbl", "udta", "meta", "edts", "dinf"].includes(node.type)
    ) {
      const body = join([
        ...(node.type === "meta" ? [node.data.subarray(0, 4)] : []),
        ...node.children.map((n) => rebuild(n, delta)),
        ...(node === moov && !first
          ? [atom("udta", atom("meta", join([new Uint8Array(4), replacement])))]
          : [])
      ]);
      return atom(node.type, body);
    }
    return ast.data.subarray(node.offset, node.offset + node.size);
  }
  const preliminary = rebuild(moov, 0),
    delta = preliminary.length - moov.size,
    updated = rebuild(moov, delta);
  return join(
    ast.nodes.map((node) =>
      node === moov ? updated : ast.data.subarray(node.offset, node.offset + node.size)
    )
  );
}
/** Merge normalized tags, retaining unknown metadata and encoded audio payloads. */
export function rewriteMetadata(
  ast: AudioAst,
  updates: AudioTags,
  options: MetadataOptions = {}
): Uint8Array {
  const tags = { ...ast.tags, ...updates },
    pictures = options.pictures ?? ast.pictures;
  switch (ast.format) {
    case "wav": {
      const chunks = ast.nodes
        .filter(
          (n) =>
            !(
              n.type === "LIST" && new Reader(n.data).text(0, Math.min(4, n.data.length)) === "INFO"
            )
        )
        .map((n) => riffChunk(n.type, n.data));
      chunks.push(wavInfo(tags));
      const body = join([ascii("WAVE"), ...chunks]);
      return join([ascii("RIFF"), uint32(body.length, true), body]);
    }
    case "mp3":
      return join([
        encodeId3(tags, ast.nodes.find((n) => n.type === "ID3")?.children ?? [], pictures),
        ...ast.nodes.filter((n) => n.type === "MPEG").map((n) => n.data)
      ]);
    case "flac": {
      const blocks = ast.nodes
        .filter((n) => !["FRAMES", "VORBIS_COMMENT", "PICTURE", "PADDING"].includes(n.type))
        .map((n) => ({ type: ast.data[n.offset]! & 127, data: n.data }));
      const vendor = ast.nodes.find((n) => n.type === "VORBIS_COMMENT")?.fields?.vendor;
      blocks.push({
        type: 4,
        data: encodeComments(tags, typeof vendor === "string" ? vendor : undefined)
      });
      for (const p of pictures) blocks.push({ type: 6, data: encodePicture(p) });
      return join([
        ascii("fLaC"),
        ...blocks.map((b, i) => {
          if (b.data.length > 0xffffff) throw new Error("FLAC metadata block too large");
          return join([
            new Uint8Array([
              b.type | (i === blocks.length - 1 ? 128 : 0),
              b.data.length >>> 16,
              (b.data.length >>> 8) & 255,
              b.data.length & 255
            ]),
            b.data
          ]);
        }),
        ...ast.nodes.filter((n) => n.type === "FRAMES").map((n) => n.data)
      ]);
    }
    case "ogg": {
      const { packets } = readOgg(ast.data);
      for (const packet of packets) {
        const r = new Reader(packet.data),
          opus = packet.data.length >= 8 && r.text(0, 8) === "OpusTags",
          vorbis = packet.data.length >= 7 && r.u8(0) === 3 && r.text(1, 6) === "vorbis";
        if (opus || vorbis) {
          const parsed = parseComments(packet.data.subarray(opus ? 8 : 7));
          const merged = { ...parsed.tags, ...updates };
          if (options.pictures) {
            delete merged.METADATA_BLOCK_PICTURE;
            if (pictures.length)
              merged.METADATA_BLOCK_PICTURE = pictures.map(pictureBase64).join("\n");
          }
          packet.data = join([
            packet.data.subarray(0, opus ? 8 : 7),
            encodeComments(merged, parsed.vendor),
            ...(vorbis ? [new Uint8Array([1])] : [])
          ]);
        }
      }
      return encodeOgg(packets);
    }
    case "m4a":
      return writeMp4(ast, tags, pictures);
  }
}
