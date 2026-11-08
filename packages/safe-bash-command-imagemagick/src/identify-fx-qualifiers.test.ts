import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand } from "./index.js";

it.each([
  { expression: "p.alpha", exitCode: 1 },
  { expression: "mean.alpha", exitCode: 1 },
  { expression: "p.opacity", exitCode: 1 },
  { expression: "mean.opacity", exitCode: 1 },
  { expression: "p.a", exitCode: 0 },
  { expression: "mean.a", exitCode: 0 }
])("identify validates FX qualifier in $expression", async ({ expression, exitCode }) => {
  const bytes = await sharp(new Uint8Array([200, 100, 50, 128]), {
    raw: { width: 1, height: 1, channels: 4 }
  }).png().toBuffer();
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  const argumentValues = createCommandArguments(["-format", `%[fx:${expression}]`, "/input.png"]);
  let stdout = "", stderr = "";
  const result = await createIdentifyCommand().execute({
    command: "identify", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  expect(result.exitCode).toBe(exitCode);
  expect(stdout).toBe(exitCode === 0 ? "0.501961" : "");
  if (exitCode === 0) expect(stderr).toBe("");
  else expect(stderr).toContain("Bad channel qualifier");
});
