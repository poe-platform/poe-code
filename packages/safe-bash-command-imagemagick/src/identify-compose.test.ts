import { expect, it } from "vitest";
import { decodeImage, encodePngImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCliSync } from "./index.js";
import fixtures from "./source-text-fixtures.json" with { type: "json" };

const ppm = new Uint8Array([
  ...new TextEncoder().encode("P6\n3 2\n255\n"),
  255, 0, 0, 0, 255, 0, 0, 0, 255,
  255, 0, 0, 0, 255, 0, 0, 0, 255
]);

it.each([
  { name: "PPM default", bytes: ppm, compose: "Over" },
  { name: "tagged PNG default", bytes: Buffer.from(fixtures.png, "base64"), compose: "Over" },
  { name: "explicit PNG compose", bytes: encodePngImage({ ...decodeImage(ppm), properties: { compose: "Multiply" } }), compose: "Multiply" }
])("formats compose without warnings for $name", async ({ bytes, compose }) => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", bytes);
  for (const ping of [[], ["-ping"]]) {
    const args = [...ping, "-format", "%[compose]|%[COMPOSE]|%%[compose]", "/input"];
    const expected = { exitCode: 0, stdout: `${compose}|${compose}|%[compose]`, stderr: "" };
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
    expect(runIdentifyCliSync(args, new Map([["/input", bytes]]))).toEqual(expected);
  }
});
