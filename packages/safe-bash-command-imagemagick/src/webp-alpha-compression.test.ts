import { expect, it } from "vitest";
import sharp, { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

function chunks(bytes: Uint8Array, name: string): Uint8Array[] {
  const found: Uint8Array[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 12; at < bytes.length;) {
    const size = view.getUint32(at + 4, true);
    const kind = new TextDecoder().decode(bytes.subarray(at, at + 4));
    const payload = bytes.subarray(at + 8, at + 8 + size);
    if (kind === name) found.push(payload);
    if (kind === "ANMF") found.push(...chunks(payload.subarray(4), name));
    at += 8 + size + (size & 1);
  }
  return found;
}

for (const retained of [false, true]) for (const write of [false, true]) for (const animated of [false, true]) {
  it(`stores exact compressed or raw alpha (retained=${retained}, write=${write}, animated=${animated})`, async () => {
    const data = Uint8Array.from(Array.from({ length: 64 * 48 }, (_, i) => {
      const x = i % 64, y = Math.floor(i / 64);
      return [(x * 17 + y * 7) % 256, (x * 13 + y * 23) % 256, (x * 9 + y * 11) % 256, x % 7 === 0 ? 0 : (x * 5 + y * 11) % 256];
    }).flat());
    const alpha = data.filter((_, i) => i % 4 === 3);
    const input = encodeImage({ format: "png", width: 64, height: 48, data, channels: 4, depth: "uchar", space: "srgb", hasAlpha: true, density: 72 }, { format: "png" }).data;
    const files = new Map([["/in.png", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    const outputs: Uint8Array[] = [];
    for (const args of [["-define", "webp:alpha-compression=0"], ["-define", "webp:alpha-compression=1"], ["-define", "webp:alpha-compression=0", "+define", "webp:alpha-compression"]]) {
      const result = await runConvertCli(["/in.png", ...(animated ? ["(", "/in.png", "-channel", "RGB", "-negate", "+channel", ")"] : []), ...args, ...(write ? ["-write", "/out.webp", "null:"] : ["/out.webp"])], retained ? { filesystem, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      outputs.push(retained ? await filesystem.readFile("/out.webp") : files.get("/out.webp")!);
    }
    for (const [index, bytes] of outputs.entries()) {
      const planes = chunks(bytes, "ALPH");
      expect(planes).toHaveLength(animated ? 2 : 1);
      for (const plane of planes) {
        expect(plane[0]! & 3).toBe(index === 0 ? 0 : 1);
        if (index === 0) { expect(plane).toHaveLength(3073); expect(plane.subarray(1)).toEqual(alpha); }
      }
      for (let page = 0; page < (animated ? 2 : 1); page++) expect(decodeImage(bytes, { page }).data.filter((_, i) => i % 4 === 3)).toEqual(alpha);
      expect(chunks(bytes, "VP8 ")).toEqual(chunks(outputs[0]!, "VP8 "));
    }
    expect(outputs[2]).toEqual(outputs[1]);
  });
}

for (const value of ["-1", "2", "0.5", "no", ""]) it(`rejects invalid alpha compression ${JSON.stringify(value)}`, async () => {
  const result = await runConvertCli(["-size", "1x1", "xc:red", "-define", `webp:alpha-compression=${value}`, "/out.webp"], new Map());
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("webp:alpha-compression must be 0 or 1");
});

it("exposes alpha compression through the image API and preserves lossless and opaque output", async () => {
  const data = Uint8Array.from(Array.from({ length: 256 }, (_, i) => [90, 60, 30, i]).flat());
  for (const lossless of [false, true]) {
    const bytes = await sharp(data, { raw: { width: 16, height: 16, channels: 4 } }).webp({ alphaCompression: 0, lossless }).toBuffer();
    expect(decodeImage(bytes).data.filter((_, i) => i % 4 === 3)).toEqual(data.filter((_, i) => i % 4 === 3));
    if (lossless) { expect(chunks(bytes, "ALPH")).toHaveLength(0); expect(chunks(bytes, "VP8L")).toHaveLength(1); }
    else expect(chunks(bytes, "ALPH")[0]![0]).toBe(0);
  }
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const bytes = await sharp(data, { raw: { width: 16, height: 16, channels: 4 } }).webp({ alphaCompression: 0, lossless: false }).toBuffer();
  expect(chunks(bytes, "ALPH")).toHaveLength(0);
});
