import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) {
  for (const write of [false, true]) {
    it(`applies WebP method to VP8 compression (retained=${retained}, write=${write})`, async () => {
      const data = Uint8Array.from(Array.from({ length: 64 * 48 }, (_, i) => {
        const x = i % 64, y = Math.floor(i / 64);
        return [(x * 17 + y * 7) % 256, (x * 13 + y * 23) % 256, (x * 9 + y * 11) % 256, x % 7 === 0 ? 0 : (x * 5 + y * 11) % 256];
      }).flat());
      const input = encodeImage({ format: "png", width: 64, height: 48, data, channels: 4, depth: "uchar", space: "srgb", hasAlpha: true, density: 72 }, { format: "png" }).data;
      const files = new Map([["/in.png", input]]);
      const filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.png", input);
      const payloads: Uint8Array[] = [];
      const decoded: Uint8Array[] = [];
      for (const defines of [["-define", "webp:method=0"], ["-define", "webp:method=6"], [], ["-define", "webp:method=0", "+define", "webp:method"]]) {
        const result = await runConvertCli(["/in.png", ...defines, ...(write ? ["-write", "/out.webp", "null:"] : ["/out.webp"])], retained ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = retained ? await filesystem.readFile("/out.webp") : files.get("/out.webp")!;
        let vp8: Uint8Array | undefined;
        const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
        for (let at = 12; at < output.length;) {
          const size = view.getUint32(at + 4, true);
          if (new TextDecoder().decode(output.subarray(at, at + 4)) === "VP8 ") vp8 = output.slice(at + 8, at + 8 + size);
          at += 8 + size + (size & 1);
        }
        expect(vp8).toBeDefined();
        payloads.push(vp8!);
        const image = decodeImage(output);
        expect(image).toMatchObject({ width: 64, height: 48 });
        expect(image.data.filter((_, i) => i % 4 === 3)).toEqual(data.filter((_, i) => i % 4 === 3));
        decoded.push(image.data);
      }
      expect(payloads[1]!.length).toBeLessThan(payloads[0]!.length);
      expect(decoded[1]).toEqual(decoded[0]);
      expect(payloads[3]).toEqual(payloads[2]);
    });
  }
}

it.each(["-1", "7", "1.5", "bad", ""])("rejects invalid webp:method=%s", async method => {
  const result = await runConvertCli(["xc:red", "-define", `webp:method=${method}`, "/out.webp"], new Map());
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("webp:method");
});
