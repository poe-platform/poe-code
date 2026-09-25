import { Reader, ascii, join, uint32 } from "./binary.js";
import type { AudioPicture, AudioTags } from "./types.js";
const names: Record<string, string> = {
  TITLE: "title",
  ARTIST: "artist",
  ALBUM: "album",
  ALBUMARTIST: "albumArtist",
  TRACKNUMBER: "track",
  DISCNUMBER: "disc",
  DATE: "date",
  GENRE: "genre",
  COMMENT: "comment",
  DESCRIPTION: "comment",
  ENCODER: "encoder",
  COPYRIGHT: "copyright"
};
export function parseComments(bytes: Uint8Array): {
  tags: AudioTags;
  vendor: string;
  comments: string[];
  size: number;
} {
  const r = new Reader(bytes),
    vendorSize = r.u32(0, true),
    vendor = new TextDecoder().decode(r.slice(4, vendorSize));
  let offset = 4 + vendorSize;
  const count = r.u32(offset, true);
  offset += 4;
  if (count > (bytes.length - offset) / 4) throw new Error("Invalid Vorbis comment count");
  const tags: AudioTags = {},
    comments: string[] = [];
  for (let i = 0; i < count; i++) {
    const size = r.u32(offset, true);
    offset += 4;
    const value = new TextDecoder().decode(r.slice(offset, size));
    offset += size;
    comments.push(value);
    const split = value.indexOf("=");
    if (split > 0) {
      const key = value.slice(0, split).toUpperCase(),
        name = names[key] ?? key;
      tags[name] = tags[name] ? `${tags[name]}\n${value.slice(split + 1)}` : value.slice(split + 1);
    }
  }
  return { tags, vendor, comments, size: offset };
}
export function encodeComments(tags: AudioTags, vendor = "poe-code/audio-ast"): Uint8Array {
  const encoder = new TextEncoder(),
    v = encoder.encode(vendor),
    comments: Uint8Array[] = [];
  for (const [name, value] of Object.entries(tags)) {
    const key = Object.keys(names).find((key) => names[key] === name) ?? name.toUpperCase();
    if (
      key.includes("=") ||
      Array.from(key).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 125)
    )
      throw new Error("Invalid Vorbis comment key");
    for (const part of value.split("\n")) {
      const bytes = encoder.encode(`${key}=${part}`);
      comments.push(join([uint32(bytes.length, true), bytes]));
    }
  }
  return join([uint32(v.length, true), v, uint32(comments.length, true), ...comments]);
}
export function parsePicture(bytes: Uint8Array): AudioPicture {
  const r = new Reader(bytes),
    type = r.u32(0),
    mimeSize = r.u32(4),
    mime = r.text(8, mimeSize);
  let offset = 8 + mimeSize;
  const descriptionSize = r.u32(offset);
  offset += 4;
  const description = new TextDecoder().decode(r.slice(offset, descriptionSize));
  offset += descriptionSize;
  const width = r.u32(offset),
    height = r.u32(offset + 4),
    depth = r.u32(offset + 8),
    colors = r.u32(offset + 12),
    size = r.u32(offset + 16);
  offset += 20;
  const data = r.slice(offset, size);
  if (offset + size !== bytes.length) throw new Error("Trailing FLAC picture bytes");
  return { type, mime, description, width, height, depth, colors, data };
}
export function encodePicture(p: AudioPicture): Uint8Array {
  const description = new TextEncoder().encode(p.description),
    mime = ascii(p.mime);
  return join([
    uint32(p.type),
    uint32(mime.length),
    mime,
    uint32(description.length),
    description,
    uint32(p.width ?? 0),
    uint32(p.height ?? 0),
    uint32(p.depth ?? 0),
    uint32(p.colors ?? 0),
    uint32(p.data.length),
    p.data
  ]);
}

export function pictureBase64(picture: AudioPicture): string {
  const bytes = encodePicture(picture);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
