import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand } from "./index.js";

for (const magick of [false, true]) {
  it.each([
    ["ppm", "/tile.ppm"],
    ["ppm", "/tile.png"],
    ["png", "/tile.ppm"],
    ["png", "/tile"]
  ] as const)(`${magick ? "magick identify" : "identify"} expands the detected %s coder for %s`, async (format, path) => {
    const bytes = encodeImage({
      width: 3, height: 2, format, space: "srgb", channels: 3,
      depth: "uchar", density: 72, hasAlpha: false,
      data: Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
        255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255])
    }, { format }).data;
    const fs = new MemoryFileSystem();
    await fs.writeFile(path, bytes);
    const command = magick ? createMagickCommand() : createIdentifyCommand();
    const argumentValues = createCommandArguments([
      ...(magick ? ["identify"] : []), "-format", "%m|%[magick]", path
    ]);
    let stdout = "", stderr = "";
    const result = await command.execute({
      command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect({ ...result, stdout, stderr }).toEqual({
      exitCode: 0, stdout: `${format.toUpperCase()}|${format.toUpperCase()}`, stderr: ""
    });
  });
}
