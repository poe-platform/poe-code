import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCliSync } from "./index.js";
import fixtures from "./source-text-fixtures.json" with { type: "json" };

it.each([
  { name: "embedded PNG label", bytes: Buffer.from(fixtures.png, "base64"), format: "%l|%[label]|%%l", stdout: "old-label|old-label|%l" },
  { name: "unlabeled PPM", bytes: new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n"), format: "%l", stdout: "" }
])("expands %l silently for an $name", async ({ bytes, format, stdout }) => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", bytes);
  const args = ["-format", format, "/input"];
  const expected = { exitCode: 0, stdout, stderr: "" };
  for (const command of [createIdentifyCommand(), createMagickCommand()]) {
    const argumentValues = createCommandArguments(command.name === "magick" ? ["identify", ...args] : args);
    let output = "", stderr = "";
    const result = await command.execute({
      command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect({ ...result, stdout: output, stderr }).toEqual(expected);
  }
  expect(runIdentifyCliSync(args, new Map([["/input", bytes]]))).toEqual(expected);
});
