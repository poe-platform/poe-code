import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

it.each(["xc:red", "canvas:red", "one.ppm"])("identifies %s dimensions", async source => {
  const bytes = new Uint8Array([...new TextEncoder().encode("P6\n1 1\n255\n"), 255, 0, 0]);
  const files = new Map([["one.ppm", bytes]]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/one.ppm", bytes);
  const args = ["-format", "%wx%h", source];
  const expected = { exitCode: 0, stdout: "1x1", stderr: "" };
  expect(runIdentifyCliSync(args, files)).toEqual(expected);
  for (const input of [files, { filesystem: fs, cwd: "/" }]) {
    expect(await runIdentifyCli(args, input)).toEqual(expected);
  }
  for (const command of [createIdentifyCommand(), createMagickCommand()]) {
    const argumentValues = createCommandArguments(command.name === "magick" ? ["identify", ...args] : args);
    let stdout = "", stderr = "";
    const result = await command.execute({
      command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect({ ...result, stdout, stderr }).toEqual(expected);
  }
});

it.each(["xc:red", "canvas:red"])("reads %s pixels without a file", async source => {
  const args = ["-format", "%[fx:r],%[fx:g],%[fx:b]", source];
  const expected = { exitCode: 0, stdout: "1,0,0", stderr: "" };
  expect(runIdentifyCliSync(args, new Map())).toEqual(expected);
  expect(await runIdentifyCli(args, { filesystem: new MemoryFileSystem(), cwd: "/" })).toEqual(expected);
});
