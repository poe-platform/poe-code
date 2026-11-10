import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync, runMagickCli, runMagickCliSync } from "./index.js";

it.each(["png", "ppm"])("reports original %s dimensions independently of the virtual canvas", async format => {
  const bytes = format === "ppm"
    ? new TextEncoder().encode("P3\n3 2\n255\n255 0 0 0 255 0 0 0 255\n255 0 0 0 255 0 0 0 255\n")
    : encodeImage({
      width: 3, height: 2, data: new Uint8Array(3 * 2 * 4).fill(255),
      format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false,
      virtualCanvas: { width: 12, height: 10, x: 3, y: 4 }
    }, { format: "png" }).data;
  const path = `/image.${format}`;
  const fs = new MemoryFileSystem();
  await fs.writeFile(path, bytes);
  const files = new Map([[path, bytes]]);
  const args = ["-format", "%G|%g|%P|%%G", path];
  const expected = { exitCode: 0, stdout: format === "png" ? "3x2|12x10+3+4|12x10|%G" : "3x2|3x2+0+0|3x2|%G", stderr: "" };
  expect(runIdentifyCliSync(args, files)).toEqual(expected);
  for (const input of [files, { filesystem: fs, cwd: "/" }]) {
    expect(await runIdentifyCli(args, input)).toEqual(expected);
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
    expect({ ...result, stdout, stderr }).toEqual(expected);
  }
});

it("keeps original dimensions after resizing in shared property formatting", async () => {
  const bytes = new TextEncoder().encode("P3\n3 2\n255\n255 0 0 0 255 0 0 0 255\n255 0 0 0 255 0 0 0 255\n");
  const files = new Map([["/image.ppm", bytes]]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/image.ppm", bytes);
  const args = ["/image.ppm", "-resize", "6x4!", "-format", "%G|%wx%h|%g|%P", "info:"];
  const expected = { exitCode: 0, stdout: "3x2|6x4|6x4+0+0|6x4", stderr: "" };
  expect(runMagickCliSync(args, files)).toEqual(expected);
  for (const input of [files, { filesystem: fs, cwd: "/" }]) {
    expect(await runMagickCli(args, input)).toEqual(expected);
  }
});
