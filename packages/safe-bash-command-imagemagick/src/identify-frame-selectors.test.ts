import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

// Native ImageMagick: magick -size 2x3 xc:blue xc:green movie.gif
const bytes = Uint8Array.from(Buffer.from("R0lGODlhAgADAPAAAAAA/wAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAAAAACwAAAAAAgADAAACAoRfACH5BAAAAAAALAAAAAACAAMAgACAAAAAAAIChF8AOw==", "base64"));

it.each([
  ["0", "0;"], ["1", "1;"], ["1,0", "1;0;"], ["0-1", "0;1;"],
  ["-1", "1;"], ["1-0", "1;0;"], ["-2--1", "0;1;"],
  ["1,0,1", "1;0;1;"], [" 1 , 0 ", "1;0;"]
])("identifies ordered input scenes [%s] across SDK and commands", async (selector, stdout) => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/movie.gif", bytes);
  const files = new Map([["/movie.gif", bytes]]);
  const args = ["-format", "%s;", `/movie.gif[${selector}]`];
  const expected = { exitCode: 0, stdout, stderr: "" };
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
