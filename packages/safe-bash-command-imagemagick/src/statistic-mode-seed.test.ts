import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete RGB8 rasters from ImageMagick 7.1.2-35 Q16-HDRI, one thread.
const cases = [
  {
    "width": 5,
    "height": 3,
    "seed": "42",
    "geometry": "3x3",
    "method": "random",
    "hash": "5fcc403c955e0dd08d2e1d04dfdd06278db15e06557497f6dbe8af60d64ced46"
  },
  {
    "width": 5,
    "height": 3,
    "seed": "0",
    "geometry": "3x3",
    "method": "random",
    "hash": "9d0503a68c423d928173aec4167634b834b4239a7e62d2c8f0ec3e48e0556967"
  },
  {
    "width": 5,
    "height": 3,
    "seed": "-2",
    "geometry": "4x2",
    "method": "random",
    "hash": "be15aaf21a69c8d11b324c976fbfbbcfdb01d6cb7eb064d860f0f9a4756acb0d"
  },
  {
    "width": 5,
    "height": 3,
    "seed": "42",
    "geometry": "3x3",
    "method": "edge",
    "hash": "de96ea14fc42b6ebefd754aa77020e622edd7843265c8b9cc55d0a47f1b6c2a4"
  },
  {
    "width": 513,
    "height": 2,
    "seed": "42",
    "geometry": "3x3",
    "method": "random",
    "hash": "54405d1813a5f6502592bb9c877053cc59fcb909231fb63894a370483a28ce5b"
  }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each(cases)(`${mode}: seeded Mode $geometry on $width x $height ($seed, $method)`, async ({ width, height, seed, geometry, method, hash }) => {
    const pixels = width === 5 ? [1, 2, 3, 1, 4, 2, 1, 4, 4, 3, 3, 2, 1, 3, 4]
        : Array.from({ length: width * height }, (_, i) => (i * 7 + Math.floor(i / width)) % 4 + 1);
    const input = Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), Buffer.from(pixels.flatMap(i => [i * 40, i * 20, 255 - i * 30]))]);
    for (let repeat = 0; repeat < 3; repeat++) {
        const fs = new MemoryFileSystem(), files = new Map([["/in.ppm", input]]);
        await fs.writeFile("/in.ppm", input);
        // A later seed must not affect a queued statistic operation.
        const args = ["-limit", "thread", "1", "-seed", seed, "/in.ppm", "-virtual-pixel", method, "-statistic", "Mode", geometry, "-seed", "123", "-depth", "8", "rgb:-"];
        const stdout: number[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(...bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        stderr = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Uint8Array.from(stdout);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    }
});
