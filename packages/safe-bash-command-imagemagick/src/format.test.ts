import { describe, expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { runMagickCli, runMagickCliSync } from "./index.js";

describe("ImageMagick property formatting", () => {
  it("never interprets substituted filenames as format strings or replacement patterns", async () => {
    const basename = "test%b-%B-%x-%y-%n-%[mean]-\\n-$&.$`%b";
    const path = `/dir-%n/${basename}`;
    const bytes = await sharp({ create: { width: 2, height: 1, channels: 3, background: "red" } }).png().toBuffer();
    const result = await runMagickCli(["identify", "-format", "%f|%i|%t|%e|%[mean]", path], new Map([[path, bytes]]));
    expect(result).toMatchObject({ exitCode: 0, stderr: "", stdout: `${basename}|${path}|${basename.slice(0, basename.lastIndexOf("."))}|$\`%b|85` });
  });

  for (const mode of ["identify", "info"] as const) {
    async function format(bytes: Uint8Array, template: string) {
      const args = mode === "identify"
        ? ["identify", "-format", template, "in.png"]
        : ["in.png", "-format", template, "info:"];
      const result = await runMagickCli(args, new Map([["in.png", bytes]]));
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      return result.stdout;
    }
    const newline = mode === "info" ? "\n" : "";

    it(`${mode}: expands geometry, metadata, compression, and literal escapes once`, async () => {
      const bytes = await sharp({ create: { width: 80, height: 40, channels: 3, background: "red" } }).png().toBuffer();
      expect(await format(bytes, "%g|%P|%%|%[channels]|%[WIDTH]x%[Height]|%[depth]|%[bit-depth]|%C|%Q|%[size]"))
        .toBe(`80x40+0+0|80x40|%|srgb|80x40|8|1|Zip|92|${bytes.byteLength}B${newline}`);
      expect(await format(bytes, "%%w|%%[mean]|%%%w|%%%%|\\n\\t%w|%[unknown]|%j|%[unfinished"))
        .toBe(`%w|%[mean]|%80|%%|\n\t80|%[unknown]|%j|%[unfinished${newline}`);
    });

    it.each([
      { pixels: [255, 0, 0, 255, 255, 0, 0, 255], opaque: "true", type: "PaletteAlpha", depth: "1" },
      { pixels: [255, 0, 0, 255, 0, 0, 255, 128], opaque: "false", type: "PaletteAlpha", depth: "8" },
      { pixels: [0, 0, 0, 255, 255, 255, 255, 255], opaque: "true", type: "Bilevel", depth: "1" },
      { pixels: [85, 85, 85, 255, 170, 170, 170, 255], opaque: "true", type: "GrayscaleAlpha", depth: "2" },
      { pixels: [85, 85, 85, 255, 170, 170, 170, 128], opaque: "false", type: "GrayscaleAlpha", depth: "8" }
    ])(`${mode}: calculates pixel properties ($type, $opaque)`, async ({ pixels, opaque, type, depth }) => {
      const bytes = await sharp(new Uint8Array(pixels), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
      expect(await format(bytes, "%[channels]|%[opaque]|%[type]|%[bit-depth]"))
        .toBe(`srgba|${opaque}|${type}|${depth}${newline}`);
    });

    it(`${mode}: computes standard deviation across spatial samples, not between color channels`, async () => {
      const red = await sharp({ create: { width: 2, height: 1, channels: 3, background: "red" } }).png().toBuffer();
      expect(await format(red, "%[standard-deviation]|%[mean]|%[min]|%[max]")).toBe(`0|85|0|255${newline}`);
      const ramp = await sharp(new Uint8Array([0, 0, 0, 255, 255, 255]), { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer();
      expect(Number((await format(ramp, "%[standard-deviation]")).trim())).toBeCloseTo(Math.sqrt(2 * 127.5 ** 2), 3);
    });

    it(`${mode}: evaluates hex, pixel, and FX expressions including brackets and arithmetic`, async () => {
      const bytes = await sharp(new Uint8Array([255, 0, 0, 0, 32, 64]), { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer();
      expect(await format(bytes, "%[hex:p{1,0}]|%[HEX:p{w-1,h-1}]|%[hex:1-u]|%[pixel:p{0,0}]|%[fx:u[0].w/h]"))
        .toBe(`002040|002040|00FFFF|srgb(255,0,0)|2${newline}`);
      const alpha = await sharp(new Uint8Array([255, 0, 0, 128]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
      expect(await format(alpha, "%[hex:p{0,0}]")).toBe(`FF000080${newline}`);
    });

    it(`${mode}: reports grayscale channels and truecolor images`, async () => {
      const gray = await sharp(new Uint8Array([85, 170]), { raw: { width: 2, height: 1, channels: 1 } }).png().toBuffer();
      expect(await format(gray, "%[channels]|%[type]|%[bit-depth]")).toBe(`gray|Grayscale|2${newline}`);
      const pixels = Uint8Array.from({ length: 257 * 3 }, (_, i) => i % 3 === 0 ? Math.floor(i / 3) % 256 : i % 3 === 1 ? Math.floor(i / (256 * 3)) : 0);
      const rgb = await sharp(pixels, { raw: { width: 257, height: 1, channels: 3 } }).png().toBuffer();
      expect(await format(rgb, "%[type]|%[opaque]")).toBe(`TrueColor|true${newline}`);
    });
  }

  it("preserves source filenames and sizes through info output transforms", async () => {
    const path = "/test%b-%n-%[mean].png";
    const bytes = await sharp({ create: { width: 8, height: 4, channels: 3, background: "red" } }).png().toBuffer();
    const result = await runMagickCli([path, "-resize", "4x2!", "-format", "%f|%i|%[width]x%[height]|%wx%h|%[size]|%[hex:p{0,0}]", "info:"], new Map([[path, bytes]]));
    expect(result).toMatchObject({ exitCode: 0, stdout: `test%b-%n-%[mean].png|${path}|8x4|4x2|${bytes.byteLength}B|FF0000\n`, stderr: "" });
  });

  it("preserves original dimensions when JPEG decoding is downscaled for a resize", async () => {
    const bytes = await sharp({ create: { width: 320, height: 240, channels: 3, background: "red" } }).jpeg().toBuffer();
    const files = new Map([["in.jpg", bytes]]);
    const args = ["in.jpg", "-resize", "64x48", "-format", "%[width]x%[height]|%wx%h|%C", "info:"];
    const result = await runMagickCli(args, files);
    expect(result).toMatchObject({ exitCode: 0, stdout: "320x240|64x48|JPEG\n", stderr: "" });
    expect(runMagickCliSync(args, files)).toEqual(result);
  });

  it("uses the selected frame for identify pixel properties", async () => {
    const files = new Map<string, Uint8Array>();
    expect((await runMagickCli(["-size", "2x1", "xc:red", "xc:blue", "frames.gif"], files)).exitCode).toBe(0);
    const result = await runMagickCli(["identify", "-format", "%s/%n:%[hex:p{0,0}]:%C", "frames.gif[1]"], files);
    expect(result).toMatchObject({ exitCode: 0, stdout: "1/2:0000FFFF:LZW", stderr: "" });
  });

  it("reports the configured info output quality and each scene", async () => {
    const result = await runMagickCli(["-size", "2x1", "xc:red", "xc:blue", "-alpha", "off", "-quality", "73", "-format", "%s/%n:%Q:%[hex:p{0,0}] ", "info:"], new Map());
    expect(result).toMatchObject({ exitCode: 0, stdout: "0/2:73:FF0000 1/2:73:0000FF \n", stderr: "" });
  });

  it("does not decode pixels for literal or metadata-only identify formats", async () => {
    const bytes = await sharp({ create: { width: 2, height: 1, channels: 3, background: "red" } }).png().toBuffer();
    // The PNG signature and IHDR are sufficient for metadata but cannot be decoded.
    const header = bytes.subarray(0, 33);
    const result = await runMagickCli(["identify", "-format", "%w|%%[hex:p{0,0}]|%f", "%[mean].png"], new Map([["%[mean].png", header]]));
    expect(result).toMatchObject({ exitCode: 0, stdout: "2|%[hex:p{0,0}]|%[mean].png", stderr: "" });
  });
});
