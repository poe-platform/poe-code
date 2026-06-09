import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Audio } from "./audio.js";
import { toContentBlocks, type ContentBlock, type TextContent } from "./convert.js";
import { Image } from "./image.js";
import { File } from "./file.js";

function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => T
): T {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true,
    });
  }

  try {
    return callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

// --- Audio ---

describe("Audio", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("fromUrl", () => {
    it("normalizes uppercase audio Content-Type values", async () => {
      const data = new Uint8Array([1, 2, 3]);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(data.buffer),
        headers: { get: () => "Audio/MPEG" },
      } as unknown as Response);

      const block = (await Audio.fromUrl("https://example.com/audio")).toContentBlock();

      expect(block.mimeType).toBe("audio/mpeg");
    });

    it("redacts query credentials from fetch failures", async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: false, status: 403, statusText: "Forbidden" } as Response);

      await expect(Audio.fromUrl("https://example.com/sound.mp3?token=secret")).rejects.toThrow(
        "Failed to fetch audio from https://example.com/sound.mp3: 403 Forbidden"
      );
    });

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
    it("rejects malformed base64 and incompatible MIME types", () => {
      expect(() => Audio.fromBase64("not base64!", "audio/mpeg")).toThrow("Invalid base64 content");
      expect(() => Audio.fromBytes(new Uint8Array([1, 2, 3]), "image/png")).toThrow("Unsupported audio MIME type");
    });

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

// --- toContentBlocks ---

describe("toContentBlocks", () => {
  describe("string conversion", () => {
    it("converts string to TextContent", () => {
      const result = toContentBlocks("Hello");

      expect(result).toEqual([{ type: "text", text: "Hello" }]);
    });

    it("converts empty string to TextContent", () => {
      const result = toContentBlocks("");

      expect(result).toEqual([{ type: "text", text: "" }]);
    });

    it("converts multiline string", () => {
      const result = toContentBlocks("Line 1\nLine 2");

      expect(result).toEqual([{ type: "text", text: "Line 1\nLine 2" }]);
    });

    it("converts string with unicode", () => {
      const result = toContentBlocks("Hello, 世界! 🌍");

      expect(result).toEqual([{ type: "text", text: "Hello, 世界! 🌍" }]);
    });

    it("converts plain objects to JSON text", () => {
      const result = toContentBlocks({ sessionId: "session-1", pid: 1234 });

      expect(result).toEqual([{ type: "text", text: '{"sessionId":"session-1","pid":1234}' }]);
    });

    it("treats undefined as no content", () => {
      const result = toContentBlocks(undefined);

      expect(result).toEqual([]);
    });
  });

  describe("Image conversion", () => {
    it("converts Image instance to ImageContent", () => {
      const image = Image.fromBase64("iVBORw0KGgo=", "image/png");
      const result = toContentBlocks(image);

      expect(result).toEqual([
        {
          type: "image",
          data: "iVBORw0KGgo=",
          mimeType: "image/png"
        }
      ]);
    });

    it("converts Image from bytes", () => {
      const pngData = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00
      ]);
      const image = Image.fromBytes(pngData);
      const result = toContentBlocks(image);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("image");
    });
  });

  describe("Audio conversion", () => {
    it("converts Audio instance to AudioContent", () => {
      const audio = Audio.fromBase64("SUQzBAAAAAA=", "audio/mpeg");
      const result = toContentBlocks(audio);

      expect(result).toEqual([
        {
          type: "audio",
          data: "SUQzBAAAAAA=",
          mimeType: "audio/mpeg"
        }
      ]);
    });

    it("converts Audio from bytes", () => {
      const mp3Data = new Uint8Array([
        0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
      ]);
      const audio = Audio.fromBytes(mp3Data);
      const result = toContentBlocks(audio);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("audio");
    });
  });

  describe("File conversion", () => {
    it("converts File instance to EmbeddedResource (binary)", () => {
      const data = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      const file = File.fromBytes(data, "video/mp4");
      const result = toContentBlocks(file);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("resource");
      expect((result[0] as { resource: { mimeType: string } }).resource.mimeType).toBe("video/mp4");
    });

    it("converts File instance to EmbeddedResource (text)", () => {
      const file = File.fromText("Hello, world!", "text/plain");
      const result = toContentBlocks(file);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("resource");
      const resource = (result[0] as { resource: { text: string; mimeType: string } }).resource;
      expect(resource.text).toBe("Hello, world!");
      expect(resource.mimeType).toBe("text/plain");
    });
  });

  describe("array conversion", () => {
    it("converts array of strings", () => {
      const result = toContentBlocks(["Hello", "World"]);

      expect(result).toEqual([
        { type: "text", text: "Hello" },
        { type: "text", text: "World" }
      ]);
    });

    it("converts array with mixed types", () => {
      const image = Image.fromBase64("iVBORw0KGgo=", "image/png");
      const audio = Audio.fromBase64("SUQzBAAAAAA=", "audio/mpeg");

      const result = toContentBlocks(["Hello", image, audio]);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ type: "text", text: "Hello" });
      expect(result[1].type).toBe("image");
      expect(result[2].type).toBe("audio");
    });

    it("converts array with Image, Audio, and File", () => {
      const image = Image.fromBase64("iVBORw0KGgo=", "image/png");
      const audio = Audio.fromBase64("SUQzBAAAAAA=", "audio/mpeg");
      const file = File.fromText("Hello", "text/plain");

      const result = toContentBlocks([image, audio, file]);

      expect(result).toHaveLength(3);
      expect(result[0].type).toBe("image");
      expect(result[1].type).toBe("audio");
      expect(result[2].type).toBe("resource");
    });

    it("converts empty array", () => {
      const result = toContentBlocks([]);

      expect(result).toEqual([]);
    });

    it("flattens nested arrays", () => {
      const image = Image.fromBase64("iVBORw0KGgo=", "image/png");

      const result = toContentBlocks(["Hello", image, "World"]);

      expect(result).toHaveLength(3);
    });
  });

  describe("raw ContentBlock passthrough", () => {
    it("passes through TextContent", () => {
      const content: ContentBlock = { type: "text", text: "raw" };
      const result = toContentBlocks(content);

      expect(result).toEqual([{ type: "text", text: "raw" }]);
    });

    it("passes through ImageContent", () => {
      const content: ContentBlock = {
        type: "image",
        data: "base64data",
        mimeType: "image/png"
      };
      const result = toContentBlocks(content);

      expect(result).toEqual([content]);
    });

    it("passes through AudioContent", () => {
      const content: ContentBlock = {
        type: "audio",
        data: "base64data",
        mimeType: "audio/mpeg"
      };
      const result = toContentBlocks(content);

      expect(result).toEqual([content]);
    });

    it("passes through EmbeddedResource", () => {
      const content: ContentBlock = {
        type: "resource",
        resource: {
          uri: "file:///test",
          mimeType: "text/plain",
          text: "content"
        }
      };
      const result = toContentBlocks(content);

      expect(result).toEqual([content]);
    });

    it("passes through raw ContentBlock in array", () => {
      const content: ContentBlock = { type: "text", text: "raw" };
      const result = toContentBlocks([content, "string"]);

      expect(result).toEqual([
        { type: "text", text: "raw" },
        { type: "text", text: "string" }
      ]);
    });

    it("does not pass through objects with inherited content block fields", () => {
      withObjectPrototypeProperties({ type: "text" }, () => {
        expect(toContentBlocks({ text: "raw" } as never)).toEqual([
          { type: "text", text: '{"text":"raw"}' }
        ]);
      });

      withObjectPrototypeProperties({ text: "polluted" }, () => {
        expect(toContentBlocks({ type: "text" } as never)).toEqual([
          { type: "text", text: '{"type":"text"}' }
        ]);
      });
    });
  });

  describe("complex mixed scenarios", () => {
    it("handles description with image", () => {
      const image = Image.fromBase64("iVBORw0KGgo=", "image/png");
      const result = toContentBlocks(["Here is the image:", image]);

      expect(result).toHaveLength(2);
      expect((result[0] as TextContent).text).toBe("Here is the image:");
      expect(result[1].type).toBe("image");
    });

    it("handles multiple images with descriptions", () => {
      const image1 = Image.fromBase64("iVBORw0KGgo=", "image/png");
      const image2 = Image.fromBase64("iVBORw0KGgo=", "image/jpeg");

      const result = toContentBlocks(["Image 1:", image1, "Image 2:", image2]);

      expect(result).toHaveLength(4);
      expect((result[0] as TextContent).text).toBe("Image 1:");
      expect(result[1].type).toBe("image");
      expect((result[2] as TextContent).text).toBe("Image 2:");
      expect(result[3].type).toBe("image");
    });

    it("handles audio with transcript", () => {
      const audio = Audio.fromBase64("SUQzBAAAAAA=", "audio/mpeg");

      const result = toContentBlocks([audio, "Transcript: Hello, world!"]);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe("audio");
      expect((result[1] as TextContent).text).toBe("Transcript: Hello, world!");
    });
  });
});

// --- File ---

describe("File", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("fromUrl", () => {
    it("uses URL paths without query credentials for resource URIs", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new TextEncoder().encode("secret").buffer),
        headers: { get: () => "text/plain" },
      } as unknown as Response);

      const block = (await File.fromUrl("https://example.com/report.txt?token=secret#part")).toContentBlock();

      expect(block.resource.uri).toBe("file:///report.txt");
    });

    it("normalizes text MIME values and preserves declared charset", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(Uint8Array.from([0x63, 0x61, 0x66, 0xe9]).buffer),
        headers: { get: () => "Text/Plain; charset=iso-8859-1" },
      } as unknown as Response);

      const block = (await File.fromUrl("https://example.com/cafe.txt")).toContentBlock();

      expect(block.resource).toMatchObject({ mimeType: "text/plain", text: "café" });
    });

    it("treats structured JSON media types as text", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new TextEncoder().encode('{"title":"failed"}').buffer),
        headers: { get: () => "application/problem+json" },
      } as unknown as Response);

      const block = (await File.fromUrl("https://example.com/problem")).toContentBlock();

      expect(block.resource).toMatchObject({ text: '{"title":"failed"}' });
    });

    it("fetches and detects MP4 from magic bytes", async () => {
      const mp4Data = new Uint8Array([
        0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
      ]);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(mp4Data.buffer),
        headers: { get: () => null },
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      const file = await File.fromUrl("https://example.com/video.mp4");
      const block = file.toContentBlock();

      expect(block.type).toBe("resource");
      expect(block.resource.mimeType).toBe("video/mp4");
      expect("blob" in block.resource).toBe(true);
      expect((block.resource as { blob: string }).blob).toBe(
        Buffer.from(mp4Data).toString("base64")
      );
    });

    it("fetches and detects WEBM from magic bytes", async () => {
      const webmData = new Uint8Array([
        0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88, 0x6d, 0x61, 0x74, 0x72,
      ]);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(webmData.buffer),
        headers: { get: () => null },
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      const file = await File.fromUrl("https://example.com/video.webm");
      const block = file.toContentBlock();

      expect(block.resource.mimeType).toBe("video/webm");
    });

    it("falls back to Content-Type header when magic bytes unknown", async () => {
      const unknownData = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(unknownData.buffer),
        headers: {
          get: (name: string) => name === "content-type" ? "application/pdf" : null,
        },
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      const file = await File.fromUrl("https://example.com/doc.pdf");
      const block = file.toContentBlock();

      expect(block.resource.mimeType).toBe("application/pdf");
    });

    it("throws on HTTP error", async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: "Not Found",
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      await expect(File.fromUrl("https://example.com/notfound.mp4")).rejects.toThrow(
        "Failed to fetch file from https://example.com/notfound.mp4: 404 Not Found"
      );
    });

    it("throws on HTTP 500 error", async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      await expect(File.fromUrl("https://example.com/error")).rejects.toThrow(
        "Failed to fetch file from https://example.com/error: 500 Internal Server Error"
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

      await expect(File.fromUrl("https://example.com/unknown")).rejects.toThrow(
        "Unable to detect MIME type"
      );
    });

    it("throws on network error", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("Network request failed"));

      await expect(File.fromUrl("https://invalid.example/file")).rejects.toThrow(
        "Network request failed"
      );
    });

    it("handles Content-Type with charset parameter", async () => {
      const unknownData = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(unknownData.buffer),
        headers: {
          get: (name: string) => name === "content-type" ? "application/json; charset=utf-8" : null,
        },
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      const file = await File.fromUrl("https://example.com/data.json");
      const block = file.toContentBlock();

      expect(block.resource.mimeType).toBe("application/json");
    });

    it("extracts filename from URL", async () => {
      const data = new Uint8Array([
        0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
      ]);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(data.buffer),
        headers: { get: () => null },
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      const file = await File.fromUrl("https://example.com/path/to/video.mp4");
      const block = file.toContentBlock();

      expect(block.resource.uri).toBe("file:///video.mp4");
    });
  });

  describe("fromBytes", () => {
    it("creates file with binary MIME type", () => {
      const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);

      const file = File.fromBytes(data, "video/mp4");
      const block = file.toContentBlock();

      expect(block.type).toBe("resource");
      expect(block.resource.mimeType).toBe("video/mp4");
      expect("blob" in block.resource).toBe(true);
    });

    it("creates file with text MIME type", () => {
      const data = new TextEncoder().encode("Hello, world!");

      const file = File.fromBytes(data, "text/plain");
      const block = file.toContentBlock();

      expect(block.type).toBe("resource");
      expect(block.resource.mimeType).toBe("text/plain");
      expect("text" in block.resource).toBe(true);
      expect((block.resource as { text: string }).text).toBe("Hello, world!");
    });

    it("creates file with application/json as text", () => {
      const data = new TextEncoder().encode('{"key": "value"}');

      const file = File.fromBytes(data, "application/json");
      const block = file.toContentBlock();

      expect("text" in block.resource).toBe(true);
      expect((block.resource as { text: string }).text).toBe('{"key": "value"}');
    });

    it("creates file with application/xml as text", () => {
      const data = new TextEncoder().encode("<root><item/></root>");

      const file = File.fromBytes(data, "application/xml");
      const block = file.toContentBlock();

      expect("text" in block.resource).toBe(true);
    });

    it("creates file with application/javascript as text", () => {
      const data = new TextEncoder().encode("console.log('hello');");

      const file = File.fromBytes(data, "application/javascript");
      const block = file.toContentBlock();

      expect("text" in block.resource).toBe(true);
    });
  });

  describe("fromText", () => {
    it("emits binary MIME text input as a blob", () => {
      const block = File.fromText("secret", "application/octet-stream").toContentBlock();

      expect(block.resource).toMatchObject({ blob: "c2VjcmV0" });
    });

    it("creates file with text content", () => {
      const file = File.fromText("Hello, world!");
      const block = file.toContentBlock();

      expect(block.type).toBe("resource");
      expect(block.resource.mimeType).toBe("text/plain");
      expect("text" in block.resource).toBe(true);
      expect((block.resource as { text: string }).text).toBe("Hello, world!");
    });

    it("uses provided MIME type", () => {
      const file = File.fromText("# Heading", "text/markdown");
      const block = file.toContentBlock();

      expect(block.resource.mimeType).toBe("text/markdown");
    });

    it("defaults to text/plain when no MIME type provided", () => {
      const file = File.fromText("plain text");
      const block = file.toContentBlock();

      expect(block.resource.mimeType).toBe("text/plain");
    });

    it("handles multiline text", () => {
      const text = "Line 1\nLine 2\nLine 3";
      const file = File.fromText(text);
      const block = file.toContentBlock();

      expect((block.resource as { text: string }).text).toBe(text);
    });

    it("handles empty string", () => {
      const file = File.fromText("");
      const block = file.toContentBlock();

      expect((block.resource as { text: string }).text).toBe("");
    });

    it("handles unicode text", () => {
      const text = "Hello, 世界! 🌍";
      const file = File.fromText(text);
      const block = file.toContentBlock();

      expect((block.resource as { text: string }).text).toBe(text);
    });
  });

  describe("fromBase64", () => {
    it("rejects malformed base64", () => {
      expect(() => File.fromBase64("%%%", "application/octet-stream")).toThrow("Invalid base64 content");
    });

    it("creates file from base64 with binary MIME type", () => {
      const base64 = Buffer.from([0x00, 0x01, 0x02, 0x03]).toString("base64");

      const file = File.fromBase64(base64, "video/mp4");
      const block = file.toContentBlock();

      expect(block.type).toBe("resource");
      expect(block.resource.mimeType).toBe("video/mp4");
      expect("blob" in block.resource).toBe(true);
      expect((block.resource as { blob: string }).blob).toBe(base64);
    });

    it("creates file from base64 with text MIME type", () => {
      const text = "Hello, world!";
      const base64 = Buffer.from(text).toString("base64");

      const file = File.fromBase64(base64, "text/plain");
      const block = file.toContentBlock();

      expect("text" in block.resource).toBe(true);
      expect((block.resource as { text: string }).text).toBe(text);
    });
  });

  describe("toContentBlock", () => {
    describe("binary content (BlobResourceContents)", () => {
      it("returns EmbeddedResource with blob for binary MIME types", () => {
        const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);

        const file = File.fromBytes(data, "video/mp4");
        const block = file.toContentBlock();

        expect(block).toEqual({
          type: "resource",
          resource: {
            uri: "file:///data",
            mimeType: "video/mp4",
            blob: Buffer.from(data).toString("base64"),
          },
        });
      });

      it("returns blob for application/octet-stream", () => {
        const data = new Uint8Array([0x00, 0x01, 0x02]);

        const file = File.fromBytes(data, "application/octet-stream");
        const block = file.toContentBlock();

        expect("blob" in block.resource).toBe(true);
      });

      it("returns blob for image types", () => {
        const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);

        const file = File.fromBytes(data, "image/png");
        const block = file.toContentBlock();

        expect("blob" in block.resource).toBe(true);
      });

      it("returns blob for audio types", () => {
        const data = new Uint8Array([0x49, 0x44, 0x33]);

        const file = File.fromBytes(data, "audio/mpeg");
        const block = file.toContentBlock();

        expect("blob" in block.resource).toBe(true);
      });
    });

    describe("text content (TextResourceContents)", () => {
      it("returns EmbeddedResource with text for text/* MIME types", () => {
        const text = "Hello, world!";
        const file = File.fromText(text, "text/plain");
        const block = file.toContentBlock();

        expect(block).toEqual({
          type: "resource",
          resource: {
            uri: "file:///data",
            mimeType: "text/plain",
            text: text,
          },
        });
      });

      it("returns text for text/html", () => {
        const html = "<html><body>Hello</body></html>";
        const file = File.fromText(html, "text/html");
        const block = file.toContentBlock();

        expect("text" in block.resource).toBe(true);
        expect((block.resource as { text: string }).text).toBe(html);
      });

      it("returns text for text/css", () => {
        const css = "body { color: red; }";
        const file = File.fromText(css, "text/css");
        const block = file.toContentBlock();

        expect("text" in block.resource).toBe(true);
      });

      it("returns text for application/json", () => {
        const json = '{"key": "value"}';
        const file = File.fromText(json, "application/json");
        const block = file.toContentBlock();

        expect("text" in block.resource).toBe(true);
      });

      it("decodes UTF-8 bytes as text for text MIME types", () => {
        const text = "Hello, 世界!";
        const data = new TextEncoder().encode(text);

        const file = File.fromBytes(data, "text/plain");
        const block = file.toContentBlock();

        expect("text" in block.resource).toBe(true);
        expect((block.resource as { text: string }).text).toBe(text);
      });
    });
  });
});

// --- Image ---

describe("Image", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("fromUrl", () => {
    it("normalizes uppercase image Content-Type values", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(Uint8Array.from([1, 2, 3]).buffer),
        headers: { get: () => "Image/PNG" },
      } as unknown as Response);

      const block = (await Image.fromUrl("https://example.com/image")).toContentBlock();

      expect(block.mimeType).toBe("image/png");
    });

    it("redacts query credentials from fetch failures", async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: false, status: 403, statusText: "Forbidden" } as Response);

      await expect(Image.fromUrl("https://example.com/picture.png?token=secret")).rejects.toThrow(
        "Failed to fetch image from https://example.com/picture.png: 403 Forbidden"
      );
    });

    it("fetches and detects PNG from magic bytes", async () => {
      const pngData = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
      ]);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(pngData.buffer),
        headers: new Map([["content-type", "image/png"]]),
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      const image = await Image.fromUrl("https://example.com/test.png");
      const block = image.toContentBlock();

      expect(block.type).toBe("image");
      expect(block.mimeType).toBe("image/png");
      expect(block.data).toBe(Buffer.from(pngData).toString("base64"));
    });

    it("fetches and detects JPEG from magic bytes", async () => {
      const jpegData = new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      ]);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(jpegData.buffer),
        headers: new Map(),
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      const image = await Image.fromUrl("https://example.com/test.jpg");
      const block = image.toContentBlock();

      expect(block.mimeType).toBe("image/jpeg");
    });

    it("falls back to Content-Type header when magic bytes unknown", async () => {
      const unknownData = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(unknownData.buffer),
        headers: {
          get: (name: string) => name === "content-type" ? "image/png" : null,
        },
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      const image = await Image.fromUrl("https://example.com/test.png");
      const block = image.toContentBlock();

      expect(block.mimeType).toBe("image/png");
    });

    it("throws on HTTP error", async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: "Not Found",
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      await expect(Image.fromUrl("https://example.com/notfound.png")).rejects.toThrow(
        "Failed to fetch image from https://example.com/notfound.png: 404 Not Found"
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

      await expect(Image.fromUrl("https://example.com/unknown")).rejects.toThrow(
        "Unable to detect image MIME type"
      );
    });

    it("throws on network error", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("Network request failed"));

      await expect(Image.fromUrl("https://invalid.example/image.png")).rejects.toThrow(
        "Network request failed"
      );
    });

    it("fetches and detects GIF from magic bytes", async () => {
      const gifData = new Uint8Array([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(gifData.buffer),
        headers: { get: () => null },
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      const image = await Image.fromUrl("https://example.com/test.gif");
      const block = image.toContentBlock();

      expect(block.mimeType).toBe("image/gif");
    });

    it("fetches and detects WEBP from magic bytes", async () => {
      const webpData = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      ]);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(webpData.buffer),
        headers: { get: () => null },
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      const image = await Image.fromUrl("https://example.com/test.webp");
      const block = image.toContentBlock();

      expect(block.mimeType).toBe("image/webp");
    });

    it("detects MIME from magic bytes even when Content-Type is different", async () => {
      const pngData = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
      ]);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(pngData.buffer),
        headers: {
          get: (name: string) => name === "content-type" ? "application/octet-stream" : null,
        },
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      const image = await Image.fromUrl("https://example.com/image");
      const block = image.toContentBlock();

      expect(block.mimeType).toBe("image/png");
    });

    it("handles Content-Type with charset parameter", async () => {
      const unknownData = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);
      const mockResponse = {
        ok: true,
        arrayBuffer: () => Promise.resolve(unknownData.buffer),
        headers: {
          get: (name: string) => name === "content-type" ? "image/png; charset=utf-8" : null,
        },
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      const image = await Image.fromUrl("https://example.com/image");
      const block = image.toContentBlock();

      expect(block.mimeType).toBe("image/png");
    });

    it("throws HTTP 500 error with status code", async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      };
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

      await expect(Image.fromUrl("https://example.com/error")).rejects.toThrow(
        "Failed to fetch image from https://example.com/error: 500 Internal Server Error"
      );
    });
  });

  describe("fromBytes", () => {
    it("detects PNG from magic bytes", () => {
      const pngData = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
      ]);

      const image = Image.fromBytes(pngData);
      const block = image.toContentBlock();

      expect(block.mimeType).toBe("image/png");
      expect(block.data).toBe(Buffer.from(pngData).toString("base64"));
    });

    it("uses explicit format when provided", () => {
      const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);

      const image = Image.fromBytes(data, "png");
      const block = image.toContentBlock();

      expect(block.mimeType).toBe("image/png");
    });

    it("accepts full MIME type as format", () => {
      const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);

      const image = Image.fromBytes(data, "image/webp");
      const block = image.toContentBlock();

      expect(block.mimeType).toBe("image/webp");
    });

    it("throws when MIME type cannot be detected", () => {
      const unknownData = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);

      expect(() => Image.fromBytes(unknownData)).toThrow(
        "Unable to detect image MIME type from bytes"
      );
    });

    it("detects JPEG from magic bytes", () => {
      const jpegData = new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      ]);

      const image = Image.fromBytes(jpegData);
      const block = image.toContentBlock();

      expect(block.mimeType).toBe("image/jpeg");
    });

    it("detects GIF from magic bytes", () => {
      const gifData = new Uint8Array([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);

      const image = Image.fromBytes(gifData);
      const block = image.toContentBlock();

      expect(block.mimeType).toBe("image/gif");
    });

    it("detects WEBP from magic bytes", () => {
      const webpData = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      ]);

      const image = Image.fromBytes(webpData);
      const block = image.toContentBlock();

      expect(block.mimeType).toBe("image/webp");
    });

    it("explicit format overrides magic byte detection", () => {
      const pngData = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
      ]);

      const image = Image.fromBytes(pngData, "image/webp");
      const block = image.toContentBlock();

      expect(block.mimeType).toBe("image/webp");
    });

    it("accepts short format for jpeg", () => {
      const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);

      const image = Image.fromBytes(data, "jpeg");
      const block = image.toContentBlock();

      expect(block.mimeType).toBe("image/jpeg");
    });

    it("accepts short format for gif", () => {
      const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);

      const image = Image.fromBytes(data, "gif");
      const block = image.toContentBlock();

      expect(block.mimeType).toBe("image/gif");
    });

    it("accepts short format for webp", () => {
      const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);

      const image = Image.fromBytes(data, "webp");
      const block = image.toContentBlock();

      expect(block.mimeType).toBe("image/webp");
    });
  });

  describe("fromBase64", () => {
    it("rejects malformed base64 and incompatible MIME types", () => {
      expect(() => Image.fromBase64("not base64!", "image/png")).toThrow("Invalid base64 content");
      expect(() => Image.fromBytes(new Uint8Array([1, 2, 3]), "audio/mpeg")).toThrow("Unsupported image MIME type");
    });

    it("creates image from base64 with MIME type", () => {
      const base64 = "iVBORw0KGgoAAAANSUhEUg==";
      const mimeType = "image/png";

      const image = Image.fromBase64(base64, mimeType);
      const block = image.toContentBlock();

      expect(block.type).toBe("image");
      expect(block.data).toBe(base64);
      expect(block.mimeType).toBe(mimeType);
    });

    it("preserves exact base64 string without modification", () => {
      const base64 = "SGVsbG8gV29ybGQh";
      const mimeType = "image/jpeg";

      const image = Image.fromBase64(base64, mimeType);
      const block = image.toContentBlock();

      expect(block.data).toBe(base64);
    });

    it("accepts any valid MIME type", () => {
      const base64 = "dGVzdA==";

      const pngImage = Image.fromBase64(base64, "image/png");
      const jpegImage = Image.fromBase64(base64, "image/jpeg");
      const gifImage = Image.fromBase64(base64, "image/gif");
      const webpImage = Image.fromBase64(base64, "image/webp");

      expect(pngImage.toContentBlock().mimeType).toBe("image/png");
      expect(jpegImage.toContentBlock().mimeType).toBe("image/jpeg");
      expect(gifImage.toContentBlock().mimeType).toBe("image/gif");
      expect(webpImage.toContentBlock().mimeType).toBe("image/webp");
    });
  });

  describe("toContentBlock", () => {
    it("returns ImageContent structure", () => {
      const pngData = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
      ]);

      const image = Image.fromBytes(pngData);
      const block = image.toContentBlock();

      expect(block).toEqual({
        type: "image",
        data: Buffer.from(pngData).toString("base64"),
        mimeType: "image/png",
      });
    });
  });
});
