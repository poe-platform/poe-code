import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true])
it(`excludes absent alpha from opaque gradient auto-level (retained=${retained})`, async () => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    expect(await runConvertCli(["-size", "1x2", "gradient:rgb(50,100,150)-rgb(150,200,220)", "-auto-level", "out.png"], retained ? { filesystem: fs, cwd: "/" } : files))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(Array.from(decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!).data))
        .toEqual([0, 75, 150, 255, 150, 225, 255, 255]);
});

for (const retained of [false, true])
it(`levels the original native 16-bit PNG reproduction (retained=${retained})`, async () => {
    // magick -size 3x1 xc:#20406080 -fill '#808080c0' -draw 'point 1,0'
    //   -fill '#e0c0a040' -draw 'point 2,0' -strip png:-
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABEAYAAABLcMj3AAAAIklEQVQI12NUUHBwSEhoaAjab64lPTXh/++sP+7/lQ8wAgByuAqOOvnl1gAAAABJRU5ErkJggg==", "base64");
    const files = new Map([["input.png", bytes]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", bytes);
    expect(await runConvertCli(["input.png", "-auto-level", "out.png"], retained ? { filesystem: fs, cwd: "/" } : files))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const actual = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!).data;
    const native = [0, 43, 85, 128, 110, 116, 122, 255, 102, 111, 119, 170];
    // Analysis works on 8-bit samples; allow one byte of input quantization error.
    for (let i = 0; i < native.length; i++) expect(Math.abs(actual[i]! - native[i]!)).toBeLessThanOrEqual(1);
});

for (const retained of [false, true])
it.each([
    { operators: ["-auto-level"], expected: [0, 43, 85, 128, 109, 116, 121, 255, 102, 110, 120, 170] },
    { operators: ["-channel", "RGB", "-auto-level", "+channel"], expected: [0, 0, 0, 128, 255, 255, 255, 224, 239, 236, 246, 160] }
])(`matches native semi-transparent auto-level (retained=${retained}): $operators`, async ({ operators, expected }) => {
    // ImageMagick 7.1.2 output for the reproduction's pixels quantized to 8-bit RGBA.
    const pixels = Uint8Array.from([32, 64, 96, 128, 114, 119, 123, 224, 109, 115, 122, 160]);
    const bytes = await sharp(pixels, { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", bytes]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", bytes);
    expect(await runConvertCli(["input.png", ...operators, "out.png"], retained ? { filesystem: fs, cwd: "/" } : files))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(Array.from(decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!).data)).toEqual(expected);
});

// Frozen from the established whole-image interpreter before retained analysis.
// Equalization vectors use native ImageMagick 7 output.
// Contrast-stretch vectors use native ImageMagick 7.1.2 RGBA output.
// Linear-stretch vectors corrected against ImageMagick 7.1.2 RGBA output.
// Normalize vectors corrected against ImageMagick 7.1.2 RGBA output.
// Default RGBA auto-level and zero auto-gamma vectors corrected against ImageMagick 7.1.2 output.
const vectors: { channels: 3 | 4; constant: number | null; operators: string[]; hash: string }[] = [
  {
    "channels": 4,
    "constant": null,
    "operators": [
      "-auto-level"
    ],
    "hash": "a5304a633f35731ed60b3e2edfe4b66dff788e70ab30811030df1e8d13071528"
  },
  {
    "channels": 4,
    "constant": null,
    "operators": [
      "-channel",
      "RB",
      "-auto-level"
    ],
    "hash": "a5acd65484ec6cbbd36f8ff43f4943dc996da819b769d6e6b7710d0cd5bd2035"
  },
  {
    "channels": 4,
    "constant": null,
    "operators": [
      "-normalize"
    ],
    "hash": "726aebb23fdf26658af4e9312fff82c6b2d009e42a1e031e11c768830485981b"
  },
  {
    "channels": 4,
    "constant": null,
    "operators": [
      "-contrast-stretch",
      "20%x5%"
    ],
    "hash": "9091d5a651eb1252f36f3476b8126bec2b3c6a217e0a8b699ef15482cd250ff4"
  },
  {
    "channels": 4,
    "constant": null,
    "operators": [
      "-linear-stretch",
      "300x200"
    ],
    "hash": "494f06d009b84c8570feda5c1c8401bf23f138687c85291c78ee7cd63a014ed9"
  },
  {
    "channels": 4,
    "constant": null,
    "operators": [
      "-auto-gamma"
    ],
    "hash": "1af5458b1c52c0e5a748be233fe14be2fda04a1c5e2750413a784c4c0ce68abf"
  },
  {
    "channels": 4,
    "constant": null,
    "operators": [
      "-equalize"
    ],
    "hash": "f8d742a7d55f81221b09854b192711036fbeb5f3bfd4540dc71b7725549e237a"
  },
  {
    "channels": 4,
    "constant": null,
    "operators": [
      "-equalize",
      "-auto-level"
    ],
    "hash": "f8d742a7d55f81221b09854b192711036fbeb5f3bfd4540dc71b7725549e237a"
  },
  {
    "channels": 3,
    "constant": null,
    "operators": [
      "-auto-level"
    ],
    "hash": "65a5c0f2be2a8e108ce3c5c70351bf250398ae4716d8c526275f5369ba8c697c"
  },
  {
    "channels": 3,
    "constant": null,
    "operators": [
      "-channel",
      "RB",
      "-auto-level"
    ],
    "hash": "e3bcf0a63a27ff2baaed25f6e670ca0005359cc0a2364b52485aab10091e38c6"
  },
  {
    "channels": 3,
    "constant": null,
    "operators": [
      "-normalize"
    ],
    "hash": "65d1d6bbc0ceea490e6df6e0795f00b1495160b91ceecd2e6b9b0225af764b0a"
  },
  {
    "channels": 3,
    "constant": null,
    "operators": [
      "-contrast-stretch",
      "20%x5%"
    ],
    "hash": "bc0b4b216ca93bb115ebd173db93f1c829028917bbd6a26c6aa6261de283dd77"
  },
  {
    "channels": 3,
    "constant": null,
    "operators": [
      "-linear-stretch",
      "300x200"
    ],
    "hash": "886fc644fdb5140ed8e1d19e2f4feb8906814080421550dbbc91cbcadf0019b3"
  },
  {
    "channels": 3,
    "constant": null,
    "operators": [
      "-auto-gamma"
    ],
    "hash": "df689440092928a63910b40152d7012f3398b29a15bfe326ba7cbc4088228cb2"
  },
  {
    "channels": 3,
    "constant": null,
    "operators": [
      "-equalize"
    ],
    "hash": "79b0a5b794971b91bce724c08da8a9846c874f3b552ff15dc5242bd8ea7a0924"
  },
  {
    "channels": 3,
    "constant": null,
    "operators": [
      "-equalize",
      "-auto-level"
    ],
    "hash": "79b0a5b794971b91bce724c08da8a9846c874f3b552ff15dc5242bd8ea7a0924"
  },
  {
    "channels": 4,
    "constant": 0,
    "operators": [
      "-auto-level"
    ],
    "hash": "24d691b0541dcad2485f7c29ec8195d31a04337a41c91ddd0b1131ad7b852faf"
  },
  {
    "channels": 4,
    "constant": 0,
    "operators": [
      "-channel",
      "RB",
      "-auto-level"
    ],
    "hash": "24d691b0541dcad2485f7c29ec8195d31a04337a41c91ddd0b1131ad7b852faf"
  },
  {
    "channels": 4,
    "constant": 0,
    "operators": [
      "-normalize"
    ],
    "hash": "24d691b0541dcad2485f7c29ec8195d31a04337a41c91ddd0b1131ad7b852faf"
  },
  {
    "channels": 4,
    "constant": 0,
    "operators": [
      "-contrast-stretch",
      "20%x5%"
    ],
    "hash": "24d691b0541dcad2485f7c29ec8195d31a04337a41c91ddd0b1131ad7b852faf"
  },
  {
    "channels": 4,
    "constant": 0,
    "operators": [
      "-linear-stretch",
      "300x200"
    ],
    "hash": "24d691b0541dcad2485f7c29ec8195d31a04337a41c91ddd0b1131ad7b852faf"
  },
  {
    "channels": 4,
    "constant": 0,
    "operators": [
      "-auto-gamma"
    ],
    "hash": "c3ae2fab99a8e189e6ad2c27a0787e4466434edd230d9494f6cae78a35f81529"
  },
  {
    "channels": 4,
    "constant": 0,
    "operators": [
      "-equalize"
    ],
    "hash": "24d691b0541dcad2485f7c29ec8195d31a04337a41c91ddd0b1131ad7b852faf"
  },
  {
    "channels": 4,
    "constant": 0,
    "operators": [
      "-equalize",
      "-auto-level"
    ],
    "hash": "24d691b0541dcad2485f7c29ec8195d31a04337a41c91ddd0b1131ad7b852faf"
  },
  {
    "channels": 4,
    "constant": 255,
    "operators": [
      "-auto-level"
    ],
    "hash": "c3ae2fab99a8e189e6ad2c27a0787e4466434edd230d9494f6cae78a35f81529"
  },
  {
    "channels": 4,
    "constant": 255,
    "operators": [
      "-channel",
      "RB",
      "-auto-level"
    ],
    "hash": "c3ae2fab99a8e189e6ad2c27a0787e4466434edd230d9494f6cae78a35f81529"
  },
  {
    "channels": 4,
    "constant": 255,
    "operators": [
      "-normalize"
    ],
    "hash": "c3ae2fab99a8e189e6ad2c27a0787e4466434edd230d9494f6cae78a35f81529"
  },
  {
    "channels": 4,
    "constant": 255,
    "operators": [
      "-contrast-stretch",
      "20%x5%"
    ],
    "hash": "c3ae2fab99a8e189e6ad2c27a0787e4466434edd230d9494f6cae78a35f81529"
  },
  {
    "channels": 4,
    "constant": 255,
    "operators": [
      "-linear-stretch",
      "300x200"
    ],
    "hash": "24d691b0541dcad2485f7c29ec8195d31a04337a41c91ddd0b1131ad7b852faf"
  },
  {
    "channels": 4,
    "constant": 255,
    "operators": [
      "-auto-gamma"
    ],
    "hash": "c3ae2fab99a8e189e6ad2c27a0787e4466434edd230d9494f6cae78a35f81529"
  },
  {
    "channels": 4,
    "constant": 255,
    "operators": [
      "-equalize"
    ],
    "hash": "c3ae2fab99a8e189e6ad2c27a0787e4466434edd230d9494f6cae78a35f81529"
  },
  {
    "channels": 4,
    "constant": 255,
    "operators": [
      "-equalize",
      "-auto-level"
    ],
    "hash": "c3ae2fab99a8e189e6ad2c27a0787e4466434edd230d9494f6cae78a35f81529"
  }
];
for (const { operators, hash, channels, constant } of vectors) {
    it(`preserves whole-image analysis for ${operators.join(" ")}, channels=${channels}, constant=${constant}`, async () => {
        const pixels = Uint8Array.from({ length: 97 * 113 * channels }, (_, i) => constant ?? Math.floor(i / 16384) * 70 + i % 53);
        const bytes = await sharp(pixels, { raw: { width: 97, height: 113, channels } }).png().toBuffer();
        const args = ["input", ...operators, "out.png"], files = new Map([["input", bytes]]), fs = new MemoryFileSystem();
        const digest = (bytes: Uint8Array) => createHash("sha256").update(decodeImage(bytes).data).digest("hex");
        expect(await runConvertCli(args, files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        expect(digest(files.get("out.png")!)).toBe(hash);
        await fs.writeFile("/input", bytes);
        const filesystem = new Proxy(fs, { get(target, key) {
            if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file analysis forbidden"); };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        } });
        expect(await runConvertCli(args, { filesystem, cwd: "/" })).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        expect(digest(await fs.readFile("/out.png"))).toBe(hash);
        expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["input", "out.png"]);
    });
}
