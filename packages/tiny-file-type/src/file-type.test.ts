import { describe, it, expect } from "vitest";
import { fileTypeFromBuffer } from "./file-type.js";

describe("fileTypeFromBuffer", () => {
  describe("images", () => {
    it("detects PNG", () => {
      // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
      const data = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
      ]);
      expect(fileTypeFromBuffer(data)).toEqual({
        mime: "image/png",
        ext: "png",
      });
    });

    it("detects JPEG", () => {
      // JPEG magic bytes: FF D8 FF
      const data = new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      ]);
      expect(fileTypeFromBuffer(data)).toEqual({
        mime: "image/jpeg",
        ext: "jpg",
      });
    });

    it("detects GIF", () => {
      // GIF magic bytes: 47 49 46 38 (GIF8)
      const data = new Uint8Array([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      expect(fileTypeFromBuffer(data)).toEqual({
        mime: "image/gif",
        ext: "gif",
      });
    });

    it("detects WEBP", () => {
      // WEBP magic bytes: RIFF....WEBP
      const data = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      ]);
      expect(fileTypeFromBuffer(data)).toEqual({
        mime: "image/webp",
        ext: "webp",
      });
    });
  });

  describe("audio", () => {
    it("detects MP3 with MPEG audio header (FF FB)", () => {
      const data = new Uint8Array([
        0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      expect(fileTypeFromBuffer(data)).toEqual({
        mime: "audio/mpeg",
        ext: "mp3",
      });
    });

    it("detects MP3 with MPEG audio header (FF FA)", () => {
      const data = new Uint8Array([
        0xff, 0xfa, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      expect(fileTypeFromBuffer(data)).toEqual({
        mime: "audio/mpeg",
        ext: "mp3",
      });
    });

    it("detects MP3 with ID3 tag", () => {
      // ID3 magic bytes: 49 44 33 (ID3)
      const data = new Uint8Array([
        0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      expect(fileTypeFromBuffer(data)).toEqual({
        mime: "audio/mpeg",
        ext: "mp3",
      });
    });

    it("detects WAV", () => {
      // WAV magic bytes: RIFF....WAVE
      const data = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
      ]);
      expect(fileTypeFromBuffer(data)).toEqual({
        mime: "audio/wav",
        ext: "wav",
      });
    });

    it("detects OGG", () => {
      // OGG magic bytes: OggS
      const data = new Uint8Array([
        0x4f, 0x67, 0x67, 0x53, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      expect(fileTypeFromBuffer(data)).toEqual({
        mime: "audio/ogg",
        ext: "ogg",
      });
    });

    it("detects M4A", () => {
      // M4A: ftyp followed by M4A brand
      const data = new Uint8Array([
        0x00, 0x00, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20,
      ]);
      expect(fileTypeFromBuffer(data)).toEqual({
        mime: "audio/mp4",
        ext: "m4a",
      });
    });
  });

  describe("video", () => {
    it("detects MP4", () => {
      // MP4: ftyp box at offset 4 with isom brand
      const data = new Uint8Array([
        0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
      ]);
      expect(fileTypeFromBuffer(data)).toEqual({
        mime: "video/mp4",
        ext: "mp4",
      });
    });

    it("detects WEBM", () => {
      // WEBM/MKV: EBML header
      const data = new Uint8Array([
        0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88, 0x6d, 0x61, 0x74, 0x72,
      ]);
      expect(fileTypeFromBuffer(data)).toEqual({
        mime: "video/webm",
        ext: "webm",
      });
    });
  });

  describe("unknown types", () => {
    it("returns undefined for unknown magic bytes", () => {
      const data = new Uint8Array([
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
      ]);
      expect(fileTypeFromBuffer(data)).toBeUndefined();
    });

    it("returns undefined for data too short", () => {
      const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      expect(fileTypeFromBuffer(data)).toBeUndefined();
    });
  });
});
