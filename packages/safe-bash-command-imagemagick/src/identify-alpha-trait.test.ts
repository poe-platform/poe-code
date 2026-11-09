import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand } from "./index.js";

for (const magick of [false, true]) {
  it.each([
    { name: "transparent PNG", format: "png", hasAlpha: true, alpha: 0, expected: "Blend" },
    { name: "opaque RGBA PNG", format: "png", hasAlpha: true, alpha: 255, expected: "Blend" },
    { name: "RGB PPM", format: "ppm", hasAlpha: false, alpha: 255, expected: "Undefined" }
  ] as const)(`${magick ? "magick identify" : "identify"} expands %A for $name`, async ({ format, hasAlpha, alpha, expected }) => {
    const bytes = encodeImage({
      width: 3, height: 2, format, space: "srgb", channels: hasAlpha ? 4 : 3,
      depth: "uchar", density: 72, hasAlpha,
      data: Uint8Array.from([255, 0, 0, alpha, 0, 255, 0, alpha, 0, 0, 255, alpha,
        255, 0, 0, alpha, 0, 255, 0, alpha, 0, 0, 255, alpha])
    }, { format, ...(format === "png" ? { pngColorType: 6 } : {}) }).data;
    const fs = new MemoryFileSystem();
    await fs.writeFile(`/input.${format}`, bytes);
    const command = magick ? createMagickCommand() : createIdentifyCommand();
    const argumentValues = createCommandArguments([
      ...(magick ? ["identify"] : []), "-format", "%A|%%A|%A", `/input.${format}`
    ]);
    let stdout = "", stderr = "";
    const result = await command.execute({
      command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: `${expected}|%A|${expected}`, stderr: "" });
  });
}
