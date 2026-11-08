import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand } from "./index.js";

it.each([
  { channels: 3, alpha: 128 },
  { channels: 4, alpha: 128 },
  { channels: 4, alpha: 255 }
] as const)("identify reports channel descriptors for $channels-channel PNG (alpha=$alpha)", async ({ channels, alpha }) => {
  const bytes = await sharp(new Uint8Array([200, 100, 50, alpha].slice(0, channels)), {
    raw: { width: 1, height: 1, channels }
  }).png().toBuffer();
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  const argumentValues = createCommandArguments(["-format", "%r|%[channels]", "/input.png"]);
  let stdout = "", stderr = "";
  const result = await createIdentifyCommand().execute({
    command: "identify", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: channels === 4 ? "DirectClass sRGB Alpha|srgba 4.0" : "DirectClass sRGB |srgb  3.0", stderr: "" });
});
