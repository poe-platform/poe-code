/**
 * Minimal magic bytes detection for common media types.
 * This can be replaced with `file-type` package (https://npm.im/file-type)
 * if more comprehensive detection is needed. The API is designed to be
 * compatible: fileTypeFromBuffer(data) returns { mime: string, ext: string } | undefined
 */

export interface FileTypeResult {
  mime: string;
  ext: string;
}

export function fileTypeFromBuffer(data: Uint8Array): FileTypeResult | undefined {
  if (data.length < 12) {
    return undefined;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return { mime: "image/png", ext: "png" };
  }

  // JPEG: FF D8 FF
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }

  // GIF: 47 49 46 38 (GIF8)
  if (
    data[0] === 0x47 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x38
  ) {
    return { mime: "image/gif", ext: "gif" };
  }

  // WEBP: 52 49 46 46 ... 57 45 42 50 (RIFF...WEBP)
  if (
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return { mime: "image/webp", ext: "webp" };
  }

  // MP3: FF FB or FF FA (MPEG audio) or 49 44 33 (ID3 tag)
  if (
    (data[0] === 0xff && (data[1] === 0xfb || data[1] === 0xfa)) ||
    (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33)
  ) {
    return { mime: "audio/mpeg", ext: "mp3" };
  }

  // WAV: 52 49 46 46 ... 57 41 56 45 (RIFF...WAVE)
  if (
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x41 &&
    data[10] === 0x56 &&
    data[11] === 0x45
  ) {
    return { mime: "audio/wav", ext: "wav" };
  }

  // OGG: 4F 67 67 53 (OggS)
  if (
    data[0] === 0x4f &&
    data[1] === 0x67 &&
    data[2] === 0x67 &&
    data[3] === 0x53
  ) {
    return { mime: "audio/ogg", ext: "ogg" };
  }

  // M4A: MP4 container with audio - check for M4A brand at offset 8
  // ftyp followed by M4A brand
  if (
    data[4] === 0x66 &&
    data[5] === 0x74 &&
    data[6] === 0x79 &&
    data[7] === 0x70 &&
    data[8] === 0x4d &&
    data[9] === 0x34 &&
    data[10] === 0x41
  ) {
    return { mime: "audio/mp4", ext: "m4a" };
  }

  // MP4: ... 66 74 79 70 (ftyp box, offset 4)
  if (
    data[4] === 0x66 &&
    data[5] === 0x74 &&
    data[6] === 0x79 &&
    data[7] === 0x70
  ) {
    return { mime: "video/mp4", ext: "mp4" };
  }

  // WEBM: 1A 45 DF A3 (EBML header)
  if (
    data[0] === 0x1a &&
    data[1] === 0x45 &&
    data[2] === 0xdf &&
    data[3] === 0xa3
  ) {
    return { mime: "video/webm", ext: "webm" };
  }

  return undefined;
}
