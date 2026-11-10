import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;
const font = existsSync("/System/Library/Fonts/Supplemental/Arial.ttf")
  ? "/System/Library/Fonts/Supplemental/Arial.ttf" : "DejaVu-Sans";

for (const execution of ["buffered", "retained", "sync", "command"] as const)
it.each(["0.75", "1.5", "1.8x1", "1", "2", "2x2", "2x1"])(`${execution}: accepts montage border %s`, async (border) => {
  const bytes = await sharp({ create: { width: 2, height: 1, channels: 3, background: "red" } }).png().toBuffer();
  const files = new Map([["a.png", bytes]]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/a.png", bytes);
  const options = ["-geometry", "+0+0", "-bordercolor", "blue", "-border", border];
  const args = [...options, "a.png", "png:-"];
  let output: Uint8Array;
  if (execution === "command") {
    const command = createMagickCommand();
    const arguments_ = createCommandArguments(["montage", ...args]);
    const chunks: number[] = [];
    let stderr = "";
    const result = await command.execute({
      command: command.name, args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { chunks.push(...chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
    });
    expect({ ...result, stderr }).toEqual({ exitCode: 0, stderr: "" });
    output = Uint8Array.from(chunks);
  } else {
    const result = execution === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, execution === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    output = result.stdoutBytes!;
  }
  const actual = decodeImage(output);
  // Native truncates the geometry width and uses it for all four sides.
  const pixels = border === "0.75" ? 0 : ["1.5", "1.8x1", "1"].includes(border) ? 1 : 2;
  const width = 2 + pixels * 2, height = 1 + pixels * 2;
  expect([actual.width, actual.height]).toEqual([width, height]);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const interior = y === pixels && (x === pixels || x === pixels + 1);
    expect(Array.from(actual.data.subarray((y * width + x) * 4, (y * width + x + 1) * 4)))
      .toEqual(interior ? [255, 0, 0, 255] : [0, 0, 255, 255]);
  }
  if (nativeAvailable) {
    const native = spawnSync("magick", ["montage", "-font", font, ...options, "png:-", "png:-"], { input: bytes });
    expect(native.status, native.stderr.toString()).toBe(0);
    const expected = decodeImage(native.stdout);
    expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
    expect(Buffer.from(actual.data).equals(expected.data)).toBe(true);
  }
});
