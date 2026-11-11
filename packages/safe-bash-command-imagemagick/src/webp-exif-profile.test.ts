import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Independent TIFF IFD0: Description and Artist use offsets, Orientation is inline.
const exif = Uint8Array.from(Buffer.from(
  "49492a000800000003000e0102000b000000320000001201030001000000060000003b010200070000003e0000000000000073697820706978656c73000050617269747900", "hex"));
const rgb = Uint8Array.from(Buffer.from("ff000000ff000000ffffee00991177245384", "hex"));
const rgba = new Uint8Array(24);
for (let i = 0; i < 6; i++) { rgba.set(rgb.subarray(i * 3, i * 3 + 3), i * 4); rgba[i * 4 + 3] = 255; }
const encoded = encodeImage({ width: 3, height: 2, data: rgba, format: "webp", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "webp", lossless: true }).data;
const format = "%wx%h|%[orientation]|%[EXIF:Orientation]|%[EXIF:Artist]|%[EXIF:ImageDescription]|%[profiles]";

for (const prefixed of [false, true]) {
  const payload = prefixed ? Uint8Array.from([69, 120, 105, 102, 0, 0, ...exif]) : exif;
  const input = new Uint8Array(encoded.length + 18 + 8 + payload.length + (payload.length & 1));
  input.set(encoded.subarray(0, 12));
  input.set([86, 80, 56, 88, 10, 0, 0, 0, 8, 0, 0, 0, 2, 0, 0, 1, 0, 0], 12);
  input.set(encoded.subarray(12), 30);
  const offset = encoded.length + 18;
  input.set([69, 88, 73, 70], offset);
  const view = new DataView(input.buffer);
  view.setUint32(4, input.length - 8, true); view.setUint32(offset + 4, payload.length, true);
  input.set(payload, offset + 8);

  for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const operation of ["query", "rewrite", "orient", "strip", "remove"] as const) {
      it(`retains complete WebP EXIF: ${operation}, ${mode}, prefixed=${prefixed}`, async () => {
        const files = new Map([["/input.webp", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.webp", input);
        const options = operation === "orient" ? ["-auto-orient"] : operation === "strip" ? ["-strip"] : operation === "remove" ? ["+profile", "exif"] : [];
        const args = ["/input.webp", ...options, ...(operation === "query" ? ["-quiet", "-format", format, "info:"] : ["/output.png"])];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: operation === "query" ? "3x2|RightTop|6|Parity|six pixels|exif" : "", stderr: "" });
        if (operation === "query") return;
        const output = mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!;
        const decoded = decodeImage(output);
        if (operation === "strip" || operation === "remove") {
          expect(decoded.exif).toBeUndefined();
        } else {
          expect(decoded.exif).toBeDefined();
          expect(await runConvertCli(["/output.png", "-quiet", "-format", format, "info:"], new Map([["/output.png", output]])))
            .toEqual({ exitCode: 0, stdout: operation === "orient" ? "2x3|TopLeft|1|Parity|six pixels|exif" : "3x2|RightTop|6|Parity|six pixels|exif", stderr: "" });
          if (operation === "rewrite") expect(decoded.exif).toEqual(exif);
        }
        expect(Buffer.from(decoded.data.filter((_, index) => index % 4 !== 3)).toString("hex"))
          .toBe(operation === "orient" ? "ffee00ff000099117700ff002453840000ff" : Buffer.from(rgb).toString("hex"));
      });
    }
  }
}
