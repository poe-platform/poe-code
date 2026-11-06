import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, runIdentifyCli } from "./index.js";

it.each([
  ["packages/pdf-ast/src/fixtures/jpeg-rgb-direct.jpg", "1x1,1x1,1x1"],
  ["docs/banners/poe-code.jpg", "2x2,1x1,1x1"]
])("identifies source JPEG sampling for %s", async (path, sampling) => {
  const fs = new MemoryFileSystem();
  const bytes = readFileSync(path!);
  await fs.writeFile("/input.jpg", bytes);
  const argumentValues = createCommandArguments(["-format", "%[jpeg:sampling-factor]", "/input.jpg"]);
  let stdout = "", stderr = "";
  const result = await createIdentifyCommand().execute({
    command: "identify", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  const expected = { exitCode: 0, stdout: sampling, stderr: "" };
  expect({ ...result, stdout, stderr }).toEqual(expected);
  expect(await runIdentifyCli(argumentValues.args, { filesystem: fs, cwd: "/" })).toEqual(expected);
  expect(await runIdentifyCli(argumentValues.args, new Map([["/input.jpg", bytes]]))).toEqual(expected);
});
