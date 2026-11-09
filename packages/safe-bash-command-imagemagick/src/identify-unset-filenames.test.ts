import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand } from "./index.js";

it.each(["identify", "magick identify"])("%s renders unset output and unique filenames without warnings", async route => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/tile.ppm", new Uint8Array([
    ...new TextEncoder().encode("P6\n3 2\n255\n"),
    255, 0, 0, 0, 255, 0, 0, 0, 255,
    255, 0, 0, 0, 255, 0, 0, 0, 255
  ]));
  const command = route === "identify" ? createIdentifyCommand() : createMagickCommand();
  for (const [format, expected] of [
    ["<%o>|<%u>", "<>|<>"],
    ["%f|%o|%u|%%o|%%u|%wx%h", "tile.ppm|||%o|%u|3x2"]
  ] as const) {
    const argumentValues = createCommandArguments([
      ...(route === "magick identify" ? ["identify"] : []), "-format", format, "tile.ppm"
    ]);
    let stdout = "", stderr = "";
    const result = await command.execute({
      command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect({ exitCode: result.exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
  }
});
