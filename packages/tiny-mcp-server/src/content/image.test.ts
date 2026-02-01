import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Image } from "./image.js";

describe("Image", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("fromUrl", () => {
    it("fetches and detects PNG from magic bytes", async () => {
      // PNG magic bytes
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
      // JPEG magic bytes
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
      // Server says octet-stream but magic bytes say PNG
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

      // Magic bytes win over headers
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
      // PNG magic bytes but explicit webp format
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
