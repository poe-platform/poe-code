import { createHash } from "node:crypto";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: sheet size and inclusive red thumbnail bounds.
for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
it.each([
  { geometry: "50%", size: [50, 50], red: [24, 24, 24, 24], hash: "db6580ea155c2716c01af369c1cc5cc44e287016455afd37b77c0df6ef27a997" },
  { geometry: "100%", size: [100, 100], red: [48, 49, 50, 50], hash: "0b13cf6739aff8f410254623eb0810fbda8cb68cf293888d0c93077982e91968" },
  { geometry: "50%+1+2", size: [3, 3], red: [0, 0, 2, 1], hash: "dcf3745e401a8a03610fda36a6a7238c53c719b7424f7546ebfe0c41e12a91d7" },
  { geometry: "4x4+0+0", size: [4, 4], red: [0, 0, 3, 2], hash: "72966d9f972a8f4ea7dfbc77dd3ef7d8577be0afc7dd5331e9942ea5ba88ca26" },
  { geometry: "200%", size: [200, 200], red: [94, 96, 105, 103] },
  { geometry: "75%", size: [75, 75], red: [36, 36, 37, 37] },
  { geometry: "50%x50%", size: [50, 50], red: [24, 24, 24, 24] },
  { geometry: "50x50%+1+2", size: [52, 54], red: [25, 26, 26, 26] },
  { geometry: "x50%", size: [50, 50], red: [23, 24, 25, 24] },
  { geometry: "50%x100%", size: [50, 100], red: [24, 49, 24, 50] },
])(`matches native percentage montage geometry via ${mode}: $geometry`, async ({ geometry, size, red, hash }) => {
  const bytes = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from("ff0000".repeat(6), "hex")]);
  const files = new Map([["tile.ppm", bytes]]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/tile.ppm", bytes);
  const args = ["tile.ppm", "-tile", "1x1", "-geometry", geometry, "-gravity", "Center", "-depth", "8", "ppm:-"];
  let output: Uint8Array;
  if (mode === "magick" || mode === "montage") {
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const stdout: Uint8Array[] = [];
    const stderr: unknown[] = [];
    const context: CommandContext = {
      command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { stdout.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk); } },
      stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
    };
    const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
    expect((await command.execute(context)).exitCode).toBe(0);
    expect(stderr).toEqual([]);
    output = Buffer.concat(stdout);
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    output = result.stdoutBytes!;
  }
  const actual = decodeImage(output);
  expect([actual.width, actual.height]).toEqual(size);
  const expected = new Uint8Array(actual.width * actual.height * 4).fill(255);
  const [left, top, right, bottom] = red as [number, number, number, number];
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++)
    expected.set([255, 0, 0, 255], (y * actual.width + x) * 4);
  expect(actual.data).toEqual(expected);
  if (hash) expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
});
