import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { encodeImage, decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const width = 128, height = 96;
const data = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  data.set([(x * 17 + y * 7) % 256, (x * 13 + y * 23) % 256, (x * 9 + y * 11) % 256, 255], (y * width + x) * 4);
}
const png = encodeImage({ width, height, data, format: "raw", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;

// Native ImageMagick 7 JPEG output, decoded with the same decoder to isolate encoding.
const nativeHashes = [
  "cfcafd50fe5d84b97e70fc7dafe8bcc61ccb8a8067d2c398b5ba35c155b2fc68",
  "caa95889e06f65a2062a7a1870b523ebf99f1dc468fe873097b60dc6aca6ba45",
  "06d91e956bc6da5516c9924d46873a0d73a0a255b6347d01b4a704d3daf22796"
];

for (const retained of [false, true]) for (const progressive of [false, true]) {
  it(`honors JPEG DCT methods on writes and final output, retained=${retained}, progressive=${progressive}`, async () => {
    const fs = new MemoryFileSystem(), files = new Map([["grid.png", png]]);
    await fs.writeFile("/grid.png", png);
    const result = await runConvertCli(["grid.png", "-quality", "92", "-interlace", progressive ? "Plane" : "None", "-define", "jpeg:dct-method=integer", "-write", "integer.jpg", "-define", "jpeg:dct-method=float", "-write", "float.jpg", "-define", "jpeg:dct-method=fastest", "-write", "fastest.jpg", "+define", "jpeg:dct-method", "-write", "default.jpg", "-define", "jpeg:dct-method=integer", "final.jpg"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const [integer, float, fastest, defaultBytes, finalBytes] = await Promise.all(["integer.jpg", "float.jpg", "fastest.jpg", "default.jpg", "final.jpg"].map(path => retained ? fs.readFile(`/${path}`) : files.get(path)!));
    expect(integer).not.toEqual(fastest);
    expect(float).not.toEqual(fastest);
    expect(float).not.toEqual(integer);
    expect(defaultBytes).toEqual(fastest);
    expect(finalBytes).toEqual(integer);
    for (const [index, bytes] of [integer, float, fastest].entries()) {
      expect(createHash("sha256").update(decodeImage(bytes!).data).digest("hex")).toBe(nativeHashes[index]);
    }
  });
}
