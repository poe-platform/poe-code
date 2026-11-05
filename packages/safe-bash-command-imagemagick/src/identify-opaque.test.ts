import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand } from "./index.js";

// ImageMagick 7 spells the opaque property as True or False.
it.each([
  { name: "opaque RGB", channels: 3, pixels: [200, 100, 50], expected: "True" },
  { name: "opaque RGBA", channels: 4, pixels: [200, 100, 50, 255], expected: "True" },
  { name: "translucent RGBA", channels: 4, pixels: [200, 100, 50, 128], expected: "False" }
] as const)("identify matches native opaque formatting for $name", async ({ channels, pixels, expected }) => {
  const bytes = await sharp(new Uint8Array(pixels), { raw: { width: 1, height: 1, channels } }).png().toBuffer();
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  const argumentValues = createCommandArguments(["-format", "%[opaque]", "/input.png"]);
  let stdout = "", stderr = "";
  const result = await createIdentifyCommand().execute({
    command: "identify", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
});
