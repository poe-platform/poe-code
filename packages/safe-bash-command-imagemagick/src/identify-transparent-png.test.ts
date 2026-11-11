import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, runIdentifyCli } from "./index.js";

it.each([
  { format: "png", alpha: 0, expected: "srgba(0,0,0,0)|00000000|0|0|0" },
  { format: "png", alpha: 128, expected: "srgba(200,100,50,0.501961)|C8643280|0.784314|0.392157|0.196078" },
  { format: "tiff", alpha: 0, expected: "srgba(0,0,0,0)|00000000|0|0|0" }
] as const)("identify samples $format pixels with alpha=$alpha", async ({ format, alpha, expected }) => {
  const bytes = await sharp(new Uint8Array([200, 100, 50, alpha]), {
    raw: { width: 1, height: 1, channels: 4 }
  }).toFormat(format).toBuffer();
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  const argumentValues = createCommandArguments(["-format", "%[pixel:p{0,0}]|%[hex:p{0,0}]|%[fx:p{0,0}.r]|%[fx:p{0,0}.g]|%[fx:p{0,0}.b]", "/input.png"]);
  let stdout = "", stderr = "";
  const result = await createIdentifyCommand().execute({
    command: "identify", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
  expect(await runIdentifyCli(argumentValues.args, { filesystem: fs, cwd: "/" }))
    .toEqual({ exitCode: 0, stdout: expected, stderr: "" });
});
