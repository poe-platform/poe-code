import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand } from "./index.js";

it.each([3, 4] as const)("identify reports Q16 separately from %i-channel PNG depth", async (channels) => {
  const bytes = await sharp(new Uint8Array([200, 100, 50, 128].slice(0, channels)), {
    raw: { width: 1, height: 1, channels }
  }).png().toBuffer();
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  const argumentValues = createCommandArguments(["-format", "%q|%z|%[bit-depth]", "/input.png"]);
  let stdout = "", stderr = "";
  const result = await createIdentifyCommand().execute({
    command: "identify", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: "16|8|8", stderr: "" });
});
