import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// Frozen from the established whole-image interpreter before retained analysis.
const vectors: { channels: 3 | 4; constant: number | null; operators: string[]; hash: string }[] = [
  {
    "channels": 4,
    "constant": null,
    "operators": [
      "-auto-level"
    ],
    "hash": "8593dff059eb6bd53caccaa72affe147575dd5e7e65026697dfbcca8da1193a2"
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
    "hash": "1c2b285fb530b7be407cb21a457ed136f7ff9c0a37e7e38c3e43781e40ad6a74"
  },
  {
    "channels": 4,
    "constant": null,
    "operators": [
      "-contrast-stretch",
      "20%x5%"
    ],
    "hash": "82761de35ca0d91d43991d5fda64a5d4a9be293265539d5835c30aa9ac843073"
  },
  {
    "channels": 4,
    "constant": null,
    "operators": [
      "-linear-stretch",
      "300x200"
    ],
    "hash": "32f8744f3df29f7b87a2129ddccf7f538b1a3d313f9c96365e0136ae11fe6ae3"
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
    "hash": "afd5c77f4ef5b2135e30ccbd28d836a920a9c17db91384d380bb21b44c47dae1"
  },
  {
    "channels": 4,
    "constant": null,
    "operators": [
      "-equalize",
      "-auto-level"
    ],
    "hash": "afd5c77f4ef5b2135e30ccbd28d836a920a9c17db91384d380bb21b44c47dae1"
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
    "hash": "a36f91c8e312000827e0cf3d5ee4c4cc974917e96f6fffed406f2097b4e0f29d"
  },
  {
    "channels": 3,
    "constant": null,
    "operators": [
      "-contrast-stretch",
      "20%x5%"
    ],
    "hash": "3264c1d0d943853c7ec2ae9779b51be87529ada3f6d8cfb8c089bed307eeefe7"
  },
  {
    "channels": 3,
    "constant": null,
    "operators": [
      "-linear-stretch",
      "300x200"
    ],
    "hash": "18182b0c8e0b1ce21f45516c856f19ef003f4d896e6f6337b68a976adb1dddde"
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
    "hash": "e236847187b4992d23fa85f9a8b538732f00b32957d577dc5282c3e6b4a59983"
  },
  {
    "channels": 3,
    "constant": null,
    "operators": [
      "-equalize",
      "-auto-level"
    ],
    "hash": "e236847187b4992d23fa85f9a8b538732f00b32957d577dc5282c3e6b4a59983"
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
    "hash": "24d691b0541dcad2485f7c29ec8195d31a04337a41c91ddd0b1131ad7b852faf"
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
    "hash": "c3ae2fab99a8e189e6ad2c27a0787e4466434edd230d9494f6cae78a35f81529"
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
    "hash": "54db08b5cce4c260bc4d74fd987e39bf6b29c772c3b7bdfede0315252706c56e"
  },
  {
    "channels": 4,
    "constant": 255,
    "operators": [
      "-equalize",
      "-auto-level"
    ],
    "hash": "54db08b5cce4c260bc4d74fd987e39bf6b29c772c3b7bdfede0315252706c56e"
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
