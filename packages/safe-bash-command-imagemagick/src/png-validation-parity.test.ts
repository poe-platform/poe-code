import { expect, it } from "vitest";
import { runConvertCli } from "./index.js";
import { decodePngImage } from "../../image-ast/src/codecs/png.js";

// Independent Pillow fixture, shared byte-for-byte with Rust png_validation.rs.
const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000008000000060806000000fe05dffb0000001649444154789c637ca611f09f010f60c2273958140000d34502699b0d22dc0000000049454e44ae426082", "hex");

it("rejects damaged critical PNG checksums without publishing output", async () => {
  for (const type of ["IHDR", "IDAT", "IEND"]) {
    const bytes = Uint8Array.from(png);
    const view = new DataView(bytes.buffer);
    for (let at = 8; at < bytes.length;) {
      const length = view.getUint32(at);
      if (new TextDecoder().decode(bytes.subarray(at + 4, at + 8)) === type) {
        bytes[at + 8 + length]! ^= 1;
        break;
      }
      at += length + 12;
    }
    for (const existing of [false, true]) {
      const files = new Map<string, Uint8Array>([["/source.png", bytes]]);
      const sentinel = new TextEncoder().encode("existing output");
      if (existing) files.set("/result.png", sentinel);
      const result = await runConvertCli(["/source.png", "/result.png"], files);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("CRC");
      expect(files.get("/result.png")).toEqual(existing ? sentinel : undefined);
    }
  }
  const files = new Map<string, Uint8Array>([["/source.png", png]]);
  expect((await runConvertCli(["/source.png", "/result.png"], files)).exitCode).toBe(0);
  expect([...decodePngImage(files.get("/result.png")!).data]).toEqual(Array.from({ length: 8 * 6 }, () => [230, 40, 80, 255]).flat());
});

it.each([1, 2, 3, 4])("rejects IEND missing %i checksum bytes without publishing output", async missing => {
  for (const existing of [false, true]) {
    const files = new Map<string, Uint8Array>([["/source.png", png.subarray(0, png.length - missing)]]);
    const sentinel = new TextEncoder().encode("existing output");
    if (existing) files.set("/result.png", sentinel);
    const result = await runConvertCli(["/source.png", "/result.png"], files);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Truncated");
    expect(files.get("/result.png")).toEqual(existing ? sentinel : undefined);
  }
});
