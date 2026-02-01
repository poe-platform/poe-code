import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { File } from "./file.js";

describe("File", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("fromUrl", () => {
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
