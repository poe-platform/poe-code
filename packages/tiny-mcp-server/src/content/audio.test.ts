import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Audio } from "./audio.js";

describe("Audio", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("fromUrl", () => {
    it("fetches and detects MP3 from magic bytes (ID3 tag)", async () => {
      const mp3Data = new Uint8Array([
        0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mp3Data.buffer),
        headers: { get: () => null },
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      const audio = await Audio.fromUrl("https://example.com/sound.mp3");
      const block = audio.toContentBlock();

      expect(block.type).toBe("audio");
      expect(block.mimeType).toBe("audio/mpeg");
      expect(block.data).toBe(Buffer.from(mp3Data).toString("base64"));
    });

    it("fetches and detects MP3 from magic bytes (MPEG frame)", async () => {
      const mp3Data = new Uint8Array([
        0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mp3Data.buffer),
        headers: { get: () => null },
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      const audio = await Audio.fromUrl("https://example.com/sound.mp3");
      const block = audio.toContentBlock();

      expect(block.mimeType).toBe("audio/mpeg");
    });

    it("fetches and detects WAV from magic bytes", async () => {
      const wavData = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
      ]);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(wavData.buffer),
        headers: { get: () => null },
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      const audio = await Audio.fromUrl("https://example.com/sound.wav");
      const block = audio.toContentBlock();

      expect(block.mimeType).toBe("audio/wav");
    });

    it("fetches and detects OGG from magic bytes", async () => {
      const oggData = new Uint8Array([
        0x4f, 0x67, 0x67, 0x53, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(oggData.buffer),
        headers: { get: () => null },
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      const audio = await Audio.fromUrl("https://example.com/sound.ogg");
      const block = audio.toContentBlock();

      expect(block.mimeType).toBe("audio/ogg");
    });

    it("fetches and detects M4A from magic bytes", async () => {
      const m4aData = new Uint8Array([
        0x00, 0x00, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20,
      ]);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(m4aData.buffer),
        headers: { get: () => null },
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      const audio = await Audio.fromUrl("https://example.com/sound.m4a");
      const block = audio.toContentBlock();

      expect(block.mimeType).toBe("audio/mp4");
    });

    it("falls back to Content-Type header when magic bytes unknown", async () => {
      const unknownData = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(unknownData.buffer),
        headers: {
          get: (name: string) => name === "content-type" ? "audio/mpeg" : null,
        },
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      const audio = await Audio.fromUrl("https://example.com/sound");
      const block = audio.toContentBlock();

      expect(block.mimeType).toBe("audio/mpeg");
    });

    it("throws on HTTP error", async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: "Not Found",
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      await expect(Audio.fromUrl("https://example.com/notfound.mp3")).rejects.toThrow(
        "Failed to fetch audio from https://example.com/notfound.mp3: 404 Not Found"
      );
    });

    it("throws on HTTP 500 error", async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      await expect(Audio.fromUrl("https://example.com/error")).rejects.toThrow(
        "Failed to fetch audio from https://example.com/error: 500 Internal Server Error"
      );
    });

    it("throws when MIME type cannot be detected", async () => {
      const unknownData = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(unknownData.buffer),
        headers: {
          get: () => null,
        },
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      await expect(Audio.fromUrl("https://example.com/unknown")).rejects.toThrow(
        "Unable to detect audio MIME type"
      );
    });

    it("throws on network error", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("Network request failed"));

      await expect(Audio.fromUrl("https://invalid.example/audio.mp3")).rejects.toThrow(
        "Network request failed"
      );
    });

    it("detects MIME from magic bytes even when Content-Type is different", async () => {
      // Server says octet-stream but magic bytes say MP3
      const mp3Data = new Uint8Array([
        0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mp3Data.buffer),
        headers: {
          get: (name: string) => name === "content-type" ? "application/octet-stream" : null,
        },
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      const audio = await Audio.fromUrl("https://example.com/audio");
      const block = audio.toContentBlock();

      expect(block.mimeType).toBe("audio/mpeg");
    });

    it("handles Content-Type with charset parameter", async () => {
      const unknownData = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(unknownData.buffer),
        headers: {
          get: (name: string) => name === "content-type" ? "audio/wav; charset=utf-8" : null,
        },
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      const audio = await Audio.fromUrl("https://example.com/audio");
      const block = audio.toContentBlock();

      expect(block.mimeType).toBe("audio/wav");
    });
  });

  describe("fromBytes", () => {
    it("detects MP3 from magic bytes (ID3 tag)", () => {
      const mp3Data = new Uint8Array([
        0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);

      const audio = Audio.fromBytes(mp3Data);
      const block = audio.toContentBlock();

      expect(block.mimeType).toBe("audio/mpeg");
      expect(block.data).toBe(Buffer.from(mp3Data).toString("base64"));
    });

    it("detects MP3 from magic bytes (MPEG frame FF FB)", () => {
      const mp3Data = new Uint8Array([
        0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);

      const audio = Audio.fromBytes(mp3Data);
      const block = audio.toContentBlock();

      expect(block.mimeType).toBe("audio/mpeg");
    });

    it("detects MP3 from magic bytes (MPEG frame FF FA)", () => {
      const mp3Data = new Uint8Array([
        0xff, 0xfa, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);

      const audio = Audio.fromBytes(mp3Data);
      const block = audio.toContentBlock();

      expect(block.mimeType).toBe("audio/mpeg");
    });

    it("detects WAV from magic bytes", () => {
      const wavData = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
      ]);

      const audio = Audio.fromBytes(wavData);
      const block = audio.toContentBlock();

      expect(block.mimeType).toBe("audio/wav");
    });

    it("detects OGG from magic bytes", () => {
      const oggData = new Uint8Array([
        0x4f, 0x67, 0x67, 0x53, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);

      const audio = Audio.fromBytes(oggData);
      const block = audio.toContentBlock();

      expect(block.mimeType).toBe("audio/ogg");
    });

    it("detects M4A from magic bytes", () => {
      const m4aData = new Uint8Array([
        0x00, 0x00, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20,
      ]);

      const audio = Audio.fromBytes(m4aData);
      const block = audio.toContentBlock();

      expect(block.mimeType).toBe("audio/mp4");
    });

    it("uses explicit format when provided (short form)", () => {
      const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);

      const audio = Audio.fromBytes(data, "wav");
      const block = audio.toContentBlock();

      expect(block.mimeType).toBe("audio/wav");
    });

    it("accepts short format for mp3", () => {
      const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);

      const audio = Audio.fromBytes(data, "mp3");
      const block = audio.toContentBlock();

      expect(block.mimeType).toBe("audio/mpeg");
    });

    it("accepts short format for ogg", () => {
      const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);

      const audio = Audio.fromBytes(data, "ogg");
      const block = audio.toContentBlock();

      expect(block.mimeType).toBe("audio/ogg");
    });

    it("accepts short format for m4a", () => {
      const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);

      const audio = Audio.fromBytes(data, "m4a");
      const block = audio.toContentBlock();

      expect(block.mimeType).toBe("audio/mp4");
    });

    it("accepts full MIME type as format", () => {
      const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);

      const audio = Audio.fromBytes(data, "audio/ogg");
      const block = audio.toContentBlock();

      expect(block.mimeType).toBe("audio/ogg");
    });

    it("explicit format overrides magic byte detection", () => {
      // WAV magic bytes but explicit mp3 format
      const wavData = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
      ]);

      const audio = Audio.fromBytes(wavData, "audio/mpeg");
      const block = audio.toContentBlock();

      expect(block.mimeType).toBe("audio/mpeg");
    });

    it("throws when MIME type cannot be detected", () => {
      const unknownData = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);

      expect(() => Audio.fromBytes(unknownData)).toThrow(
        "Unable to detect audio MIME type from bytes"
      );
    });
  });

  describe("fromBase64", () => {
    it("creates audio from base64 with MIME type", () => {
      const base64 = "SUQzBAAAAAA=";
      const mimeType = "audio/mpeg";

      const audio = Audio.fromBase64(base64, mimeType);
      const block = audio.toContentBlock();

      expect(block.type).toBe("audio");
      expect(block.data).toBe(base64);
      expect(block.mimeType).toBe(mimeType);
    });

    it("preserves exact base64 string without modification", () => {
      const base64 = "SGVsbG8gV29ybGQh";
      const mimeType = "audio/wav";

      const audio = Audio.fromBase64(base64, mimeType);
      const block = audio.toContentBlock();

      expect(block.data).toBe(base64);
    });

    it("accepts any valid MIME type", () => {
      const base64 = "dGVzdA==";

      const mp3Audio = Audio.fromBase64(base64, "audio/mpeg");
      const wavAudio = Audio.fromBase64(base64, "audio/wav");
      const oggAudio = Audio.fromBase64(base64, "audio/ogg");
      const m4aAudio = Audio.fromBase64(base64, "audio/mp4");

      expect(mp3Audio.toContentBlock().mimeType).toBe("audio/mpeg");
      expect(wavAudio.toContentBlock().mimeType).toBe("audio/wav");
      expect(oggAudio.toContentBlock().mimeType).toBe("audio/ogg");
      expect(m4aAudio.toContentBlock().mimeType).toBe("audio/mp4");
    });
  });

  describe("toContentBlock", () => {
    it("returns AudioContent structure", () => {
      const mp3Data = new Uint8Array([
        0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);

      const audio = Audio.fromBytes(mp3Data);
      const block = audio.toContentBlock();

      expect(block).toEqual({
        type: "audio",
        data: Buffer.from(mp3Data).toString("base64"),
        mimeType: "audio/mpeg",
      });
    });
  });
});
