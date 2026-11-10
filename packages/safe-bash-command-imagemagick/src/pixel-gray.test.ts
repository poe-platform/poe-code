import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7: magick <input> -format '%[pixel:p{0,0}]' info:
it.each([
  ["pixel-gray-alpha.png", "graya(120,0.117647)"],
  ["pixel-gray-opaque.png", "gray(120)"],
  ["color", "srgba(120,60,30,0.117647)"],
  ["rgb-gray", "srgba(120,120,120,0.117647)"]
])("formats %s pixels using the image colorspace", async (fixture, expected) => {
  const bytes = fixture.endsWith(".png")
    ? readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url))
    : await sharp(new Uint8Array(fixture === "color" ? [120, 60, 30, 30] : [120, 120, 120, 30]), {
      raw: { width: 1, height: 1, channels: 4 }
    }).png().toBuffer();
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  for (const identify of [false, true]) {
    const args = identify
      ? ["identify", "-format", "%[pixel:p{0,0}]", "input.png"]
      : ["input.png", "-format", "%[pixel:p{0,0}]", "info:"];
    const result = { exitCode: 0, stdout: expected, stderr: "" };
    expect(await runMagickCli(args, new Map([["input.png", bytes]]))).toEqual(result);
    expect(runMagickCliSync(args, new Map([["input.png", bytes]]))).toEqual(result);
    expect(await runMagickCli(args, { filesystem: fs, cwd: "/" })).toEqual(result);
    const argumentValues = createCommandArguments(args);
    let stdout = "", stderr = "";
    const execution = await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect({ ...execution, stdout, stderr }).toEqual(result);
  }
});
