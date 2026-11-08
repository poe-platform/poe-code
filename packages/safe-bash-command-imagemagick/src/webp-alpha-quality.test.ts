import { expect, it } from "vitest";
import sharp, { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) for (const write of [false, true]) {
  it(`controls alpha independently of RGB (retained=${retained}, write=${write})`, async () => {
    const data = Uint8Array.from(Array.from({ length: 32 * 16 }, (_, i) => [i % 256, i * 7 % 256, i * 13 % 256, i % 256]).flat());
    const input = encodeImage({ format: "png", width: 32, height: 16, data, channels: 4, depth: "uchar", space: "srgb", hasAlpha: true, density: 72 }, { format: "png" }).data;
    const files = new Map([["/in.png", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    const outputs: Uint8Array[] = [];
    for (const args of [[], ["-define", "webp:alpha-quality=20"], ["-define", "webp:alpha-quality=100"], ["-define", "webp:alpha-quality=20", "+define", "webp:alpha-quality"]]) {
      const result = await runConvertCli(["/in.png", "-quality", "80", ...args, ...(write ? ["-write", "/out.webp", "null:"] : ["/out.webp"])], retained ? { filesystem, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      outputs.push(retained ? await filesystem.readFile("/out.webp") : files.get("/out.webp")!);
    }
    const alpha = (bytes: Uint8Array) => decodeImage(bytes).data.filter((_, i) => i % 4 === 3);
    expect(alpha(outputs[0]!)).toEqual(data.filter((_, i) => i % 4 === 3));
    expect(alpha(outputs[1]!)).not.toEqual(alpha(outputs[0]!));
    expect(outputs[2]).toEqual(outputs[0]);
    expect(outputs[3]).toEqual(outputs[0]);
    const colorChunk = (bytes: Uint8Array) => {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let at = 12; at < bytes.length;) {
        const size = view.getUint32(at + 4, true);
        if (new TextDecoder().decode(bytes.subarray(at, at + 4)) === "VP8 ") return bytes.slice(at + 8, at + 8 + size);
        at += 8 + size + (size & 1);
      }
      throw new Error("Missing VP8 chunk");
    };
    expect(colorChunk(outputs[1]!)).toEqual(colorChunk(outputs[0]!));
  });
}

for (const quality of ["-1", "101", "1.5", "no", ""]) {
  it(`rejects invalid alpha quality ${JSON.stringify(quality)}`, async () => {
    const result = await runConvertCli(["-size", "1x1", "xc:red", "-define", `webp:alpha-quality=${quality}`, "/out.webp"], new Map());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("webp:alpha-quality must be an integer from 0 to 100");
  });
}

it("preserves lossless alpha and applies alpha quality to every animation frame", async () => {
  const data = Uint8Array.from(Array.from({ length: 16 * 16 }, (_, i) => [100, 80, 60, i]).flat());
  const image = { format: "png" as const, width: 16, height: 16, data, channels: 4 as const, depth: "uchar" as const, space: "srgb" as const, hasAlpha: true, density: 72 };
  const lossless = encodeImage(image, { format: "webp", lossless: true, alphaQuality: 0 }).data;
  expect(decodeImage(lossless).data).toEqual(data);
  const files = new Map([["/in.png", encodeImage(image, { format: "png" }).data]]);
  const result = await runConvertCli(["/in.png", "/in.png", "-define", "webp:alpha-quality=0", "/out.webp"], files);
  expect(result).toMatchObject({ exitCode: 0 });
  for (const page of [0, 1]) {
    const alpha = decodeImage(files.get("/out.webp")!, { page }).data.filter((_, i) => i % 4 === 3);
    expect(new Set(alpha)).toEqual(new Set([0, 255]));
  }
});

it("exposes independent alpha quality through the Sharp API", async () => {
  const data = Uint8Array.from(Array.from({ length: 256 }, (_, i) => [90, 60, 30, i]).flat());
  const bytes = await sharp(data, { raw: { width: 16, height: 16, channels: 4 } }).webp({ quality: 80, alphaQuality: 0, lossless: false }).toBuffer();
  expect(new Set(decodeImage(bytes).data.filter((_, i) => i % 4 === 3))).toEqual(new Set([0, 255]));
});
