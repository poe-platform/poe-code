import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

it.each([
  { canvas: { width: 12, height: 9, x: 2, y: 1 }, expected: "3,2|12,9|12x9+2+1" },
  { canvas: { width: 12, height: 9, x: -2, y: -1 }, expected: "3,2|12,9|12x9-2-1" },
  { canvas: undefined, expected: "3,2|3,2|3x2+0+0" }
])("reports virtual canvas dimensions independently of raster dimensions ($expected)", async ({ canvas, expected }) => {
  const bytes = encodeImage({
    width: 3, height: 2, data: new Uint8Array(3 * 2 * 4).fill(255),
    format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false,
    ...(canvas ? { virtualCanvas: canvas } : {})
  }, { format: "png" }).data;
  const fs = new MemoryFileSystem();
  await fs.writeFile("/page.png", bytes);
  const args = ["-format", "%w,%h|%W,%H|%g|%%W,%%H", "/page.png"];
  const output = { exitCode: 0, stdout: `${expected}|%W,%H`, stderr: "" };
  const files = new Map([["/page.png", bytes]]);
  expect(runIdentifyCliSync(args, files)).toEqual(output);
  for (const input of [files, { filesystem: fs, cwd: "/" }]) {
    expect(await runIdentifyCli(args, input)).toEqual(output);
  }
  for (const command of [createIdentifyCommand(), createMagickCommand()]) {
    const argumentValues = createCommandArguments(command.name === "magick" ? ["identify", ...args] : args);
    let stdout = "", stderr = "";
    const result = await command.execute({
      command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect({ ...result, stdout, stderr }).toEqual(output);
  }
});
