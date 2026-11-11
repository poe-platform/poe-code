import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Complete P6 stdout from ImageMagick 7.1.2-35 Q16-HDRI, including page
// dimensions, tile positions and white padding in entirely empty rows.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const prefix of ["", "ppm:"])
it.each([
  { count: 1, tile: "2x2", geometry: "+1+2", hash: "1f544c6521082842dae6d3a0c8f1ef69a0bb30f465c367cbb9c466b4e37f46bc" },
  { count: 1, tile: "2x1", geometry: "+1+2", hash: "c261af5da185b6754c6dec41fb13dc66ae7c28bb6a4bd5332010e2eef9526b2c" },
  { count: 1, tile: "2x2", geometry: "+1+0", hash: "75bc87611f757ba346acbfb8ff62e0ca2184ce387d2e867e3e6c6d5996308cfc" },
  { count: 5, tile: "2x2", geometry: "+1+2", hash: "80956ef74d78c9d1c438c0bac629709c6273d94f1bc49a631af8317ac7447051" }
])(`preserves empty-row montage padding via ${mode}, prefix "${prefix}": $count tiles, $tile, $geometry`, async ({ count, tile, geometry, hash }) => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const inputs = [
    [3, 2, [255, 0, 0]], [2, 4, [0, 255, 0]], [1, 3, [0, 0, 255]],
    [4, 1, [255, 0, 255]], [2, 2, [0, 255, 255]]
  ] as const;
  for (let index = 0; index < count; index++) {
    const [width, height, color] = inputs[index]!;
    const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`);
    const bytes = new Uint8Array(header.length + width * height * 3);
    bytes.set(header);
    for (let pixel = 0; pixel < width * height; pixel++) bytes.set(color, header.length + pixel * 3);
    files.set(`/in${index}.ppm`, bytes);
    await fs.writeFile(`/in${index}.ppm`, bytes);
  }
  const args = [...files.keys()].map(path => `${prefix}${path}`).concat([
    "-tile", tile, "-geometry", geometry, "-gravity", "NorthWest", "-depth", "8", "ppm:-"
  ]);
  let output: Uint8Array;
  if (mode === "command") {
    const argumentValues = createCommandArguments(["montage", ...args]);
    const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
    const context: CommandContext = {
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { errors.push(bytes.slice()); } }, registerCleanup() {}
    };
    expect((await createMagickCommand().execute(context)).exitCode).toBe(0);
    expect(Buffer.concat(errors).toString()).toBe("");
    output = Buffer.concat(chunks);
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
    output = result.stdoutBytes!;
  }
  expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
});
