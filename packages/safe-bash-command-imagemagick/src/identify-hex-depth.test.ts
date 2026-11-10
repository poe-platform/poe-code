import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runIdentifyCli, runMagickCli } from "./index.js";

it.each([
  [16, "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACEAYAAAAiJtFnAAAAJ0lEQVR4nGMQYjBhDGNsYBRiNGEKY25gYhBiMmEGMYSYTVjC2BuYAUnLBJe8dy/XAAAAAElFTkSuQmCC", "1200340156018001|1203340456078003"],
  [16, "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAIAAAAr0DSeAAAAFUlEQVQI12MUMgmrmLWHgZGBgYEBABS7Am12iOHyAAAAAElFTkSuQmCC", "123456789ABC|123556789ABC"],
  [8, "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGMQMglrAGEGGAMAJSoEcezqGxAAAAAASUVORK5CYII=", "12345680|12345680"]
] as const)("preserves %i-bit RGB/alpha hex samples", async (_depth, base64, expected) => {
  // The 16-bit PNG pixels differ only in low bytes; the 8-bit PNG is a control.
  const bytes = Buffer.from(base64, "base64");
  const format = "%[hex:p{0,0}]|%[HEX:p{1,1}]";
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  const argumentValues = createCommandArguments(["identify", "-format", format, "/input.png"]);
  let stdout = "", stderr = "";
  const result = await createMagickCommand().execute({
    command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
  for (const input of [new Map([["/input.png", bytes]]), { filesystem: fs, cwd: "/" }]) {
    expect(await runIdentifyCli(["-format", format, "/input.png"], input))
      .toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    expect(await runMagickCli(["/input.png", "-format", format, "info:"], input))
      .toEqual({ exitCode: 0, stdout: expected, stderr: "" });
  }
});
