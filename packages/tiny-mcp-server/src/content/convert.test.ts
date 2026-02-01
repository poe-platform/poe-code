import { describe, it, expect } from "vitest";
import { toContentBlocks, type ContentBlock, type TextContent } from "./convert.js";
import { Image } from "./image.js";
import { Audio } from "./audio.js";
import { File } from "./file.js";

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
  });

  describe("Image conversion", () => {
    it("converts Image instance to ImageContent", () => {
      const image = Image.fromBase64("iVBORw0KGgo=", "image/png");
      const result = toContentBlocks(image);

      expect(result).toEqual([
        {
          type: "image",
          data: "iVBORw0KGgo=",
          mimeType: "image/png",
        },
      ]);
    });

    it("converts Image from bytes", () => {
      const pngData = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
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
          mimeType: "audio/mpeg",
        },
      ]);
    });

    it("converts Audio from bytes", () => {
      const mp3Data = new Uint8Array([
        0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
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
        { type: "text", text: "World" },
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
        mimeType: "image/png",
      };
      const result = toContentBlocks(content);

      expect(result).toEqual([content]);
    });

    it("passes through AudioContent", () => {
      const content: ContentBlock = {
        type: "audio",
        data: "base64data",
        mimeType: "audio/mpeg",
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
          text: "content",
        },
      };
      const result = toContentBlocks(content);

      expect(result).toEqual([content]);
    });

    it("passes through raw ContentBlock in array", () => {
      const content: ContentBlock = { type: "text", text: "raw" };
      const result = toContentBlocks([content, "string"]);

      expect(result).toEqual([
        { type: "text", text: "raw" },
        { type: "text", text: "string" },
      ]);
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
