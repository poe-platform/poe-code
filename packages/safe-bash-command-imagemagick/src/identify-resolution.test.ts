import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync, runMagickCli, runMagickCliSync } from "./index.js";

it.each([[72, "28.34", "28.34"], [150, "59.05", "59.049999999999997"], [300, "118.11", "118.11"]] as const)(
  "reports native PNG resolution and units at %i DPI",
  async (density, resolution, shortResolution) => {
    const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } })
      .withMetadata({ density }).png().toBuffer();
    const args = ["-format", "%[resolution.x]|%[resolution.y]|%x|%y|%[units]", "input.png"];
    const expected = { exitCode: 0, stdout: `${resolution}|${resolution}|${shortResolution}|${shortResolution}|PixelsPerCentimeter`, stderr: "" };
    const files = new Map([["input.png", bytes]]);
    expect(await runIdentifyCli(args, files)).toMatchObject(expected);
    expect(runIdentifyCliSync(args, files)).toMatchObject(expected);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", bytes);
    expect(await runIdentifyCli(args, { filesystem, cwd: "/" })).toMatchObject(expected);
  }
);

// PNGs with pHYs (11811, 5906, meters) and (4, 2, unknown), checked with native identify.
it.each([
  ["iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAC4jAAAXEgGVQubbAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "118.11|59.06|PixelsPerCentimeter"],
  ["iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAAEAAAAAgA0xQamAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "4|2|Undefined"]
])("preserves independent PNG axes and units (%s)", async (encoded, stdout) => {
  const bytes = Buffer.from(encoded, "base64");
  const args = ["-format", "%[resolution.x]|%[resolution.y]|%[units]", "input.png"];
  expect(await runIdentifyCli(args, new Map([["input.png", bytes]]))).toMatchObject({ exitCode: 0, stdout, stderr: "" });
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/input.png", bytes);
  expect(await runIdentifyCli(args, { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0, stdout, stderr: "" });
});

for (const mode of ["buffered", "retained", "sync", "identify", "magick"])
it.each([
  { path: "/tile.ppm", bytes: Buffer.from("P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n0 0 0  255 255 255  128 64 32\n"), stdout: "72|72|0|0" },
  { path: "/untagged.png", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64"), stdout: "72|72|0|0" },
  { path: "/tagged.png", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAC4jAAAXEgGVQubbAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64"), stdout: "118.11|59.060000000000002|118.11|59.06" }
])(`distinguishes absent resolution from the display fallback (${mode}): $path`, async ({ path, bytes, stdout }) => {
  const files = new Map([[path, bytes]]), fs = new MemoryFileSystem();
  await fs.writeFile(path, bytes);
  const args = ["-format", "%x|%y|%[resolution.x]|%[resolution.y]", path];
  let result;
  if (mode === "sync") result = runIdentifyCliSync(args, files);
  else if (mode === "buffered" || mode === "retained") result = await runIdentifyCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  else {
    const command = mode === "magick" ? createMagickCommand() : createIdentifyCommand();
    const argumentValues = createCommandArguments([...(mode === "magick" ? ["identify"] : []), ...args]);
    let output = "", stderr = "";
    const status = await command.execute({
      command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    result = { ...status, stdout: output, stderr };
  }
  expect(result).toEqual({ exitCode: 0, stdout, stderr: "" });
});

// PNG pHYs stores 3937 x 7874 pixels/meter (100 x 200 DPI).
// Native ImageMagick uses %.17g for short escapes and %g for bracketed properties.
it("preserves native short resolution precision across command and SDK routes", async () => {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAA9hAAAewgEw8YEEAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
  const format = "%x|%y|%[resolution.x]|%[resolution.y]";
  const expected = { exitCode: 0, stdout: "39.369999999999997|78.739999999999995|39.37|78.74", stderr: "" };
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  const files = new Map([["/input.png", bytes]]);
  const args = ["-format", format, "/input.png"];
  expect(runIdentifyCliSync(args, files)).toEqual(expected);
  for (const input of [files, { filesystem: fs, cwd: "/" }]) {
    expect(await runIdentifyCli(args, input)).toEqual(expected);
    expect(await runMagickCli(["/input.png", "-format", format, "info:"], input))
      .toEqual(expected);
  }
  expect(runMagickCliSync(["/input.png", "-format", format, "info:"], files))
    .toEqual(expected);
  for (const command of [createIdentifyCommand(), createMagickCommand()]) {
    const argumentValues = createCommandArguments([...(command.name === "magick" ? ["identify"] : []), ...args]);
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
