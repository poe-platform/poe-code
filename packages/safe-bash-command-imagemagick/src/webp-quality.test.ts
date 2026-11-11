import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) {
  for (const write of [false, true]) {
    it(`honors WebP quality and mode (retained=${retained}, write=${write})`, async () => {
      const data = Uint8Array.from(Array.from({ length: 64 * 48 }, (_, i) => {
        const x = i % 64, y = Math.floor(i / 64);
        return [(x * 17 + y * 7) % 256, (x * 13 + y * 23) % 256, (x * 9 + y * 11) % 256, x % 7 === 0 ? 0 : (x * 5 + y * 11) % 256];
      }).flat());
      const input = encodeImage({ format: "png", width: 64, height: 48, data, channels: 4, depth: "uchar", space: "srgb", hasAlpha: true, density: 72 }, { format: "png" }).data;
      const files = new Map([["/in.png", input]]);
      const filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.png", input);
      const outputs: Uint8Array[] = [];
      for (const [quality, define, lossless] of [[20, undefined, false], [90, undefined, false], [100, undefined, true], [100, "false", false], [20, "true", true]] as const) {
        const result = await runConvertCli(["/in.png", "-quality", String(quality), ...(define ? ["-define", `webp:lossless=${define}`] : []), ...(write ? ["-write", "/out.webp", "null:"] : ["/out.webp"])], retained ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = retained ? await filesystem.readFile("/out.webp") : files.get("/out.webp")!;
        const chunks: string[] = [];
        const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
        for (let at = 12; at < output.length;) {
          chunks.push(new TextDecoder().decode(output.subarray(at, at + 4)));
          const size = view.getUint32(at + 4, true);
          at += 8 + size + (size & 1);
        }
        expect(chunks).toContain(lossless ? "VP8L" : "VP8 ");
        const decoded = decodeImage(output);
        expect(decoded).toMatchObject({ width: 64, height: 48 });
        expect(decoded.data.filter((_, i) => i % 4 === 3)).toEqual(data.filter((_, i) => i % 4 === 3));
        if (lossless) expect(decoded.data.filter((_, i) => data[(i - i % 4) + 3] !== 0)).toEqual(data.filter((_, i) => data[(i - i % 4) + 3] !== 0));
        else expect(decoded.data).not.toEqual(data);
        outputs.push(output);
      }
      expect(outputs[0]).not.toEqual(outputs[1]);
      expect(outputs[2]).toEqual(outputs[4]);
    });
  }
}

for (const retained of [false, true]) {
  it(`preserves lossy animation metadata and removes mode overrides (retained=${retained})`, async () => {
    const files = new Map<string, Uint8Array>();
    const filesystem = new MemoryFileSystem();
    const result = await runConvertCli([
      "-size", "16x16", "-delay", "7", "xc:red", "-delay", "19", "xc:blue", "-loop", "3",
      "-define", "webp:lossless=true", "+define", "webp:lossless", "-quality", "90", "-density", "144", "/out.webp"
    ], retained ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const bytes = retained ? await filesystem.readFile("/out.webp") : files.get("/out.webp")!;
    for (const page of [0, 1]) {
      const decoded = decodeImage(bytes, { page });
      expect(decoded).toMatchObject({ width: 16, height: 16, density: 72, loop: 3, delay: [70, 190] });
      expect(decoded.data[page === 0 ? 0 : 2]).toBeGreaterThan(240);
      expect(decoded.data[page === 0 ? 2 : 0]).toBeLessThan(15);
    }
    expect(new TextDecoder().decode(bytes)).toContain("VP8 ");
  });
}
