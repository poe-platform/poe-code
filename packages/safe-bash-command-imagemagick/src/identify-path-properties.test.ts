import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync, runMagickCli } from "./index.js";

it.each([
  { path: "pics/photo.v1.png", directory: "pics", basename: "photo.v1", extension: "png" },
  { path: "./pics/photo.v1.png", directory: "./pics", basename: "photo.v1", extension: "png" },
  { path: "pics//photo.v1.png", directory: "pics/", basename: "photo.v1", extension: "png" },
  { path: "/pics/photo.v1.png", directory: "/pics", basename: "photo.v1", extension: "png" },
  { path: "photo.v1.png", directory: "", basename: "photo.v1", extension: "png" },
  { path: "pics/photo", directory: "pics", basename: "photo", extension: "" },
  { path: "pics%w/photo%h.png", directory: "pics%w", basename: "photo%h", extension: "png" }
])("expands identify path properties without normalizing $path", async ({ path, directory, basename, extension }) => {
  const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: "red" } }).png().toBuffer();
  const fs = new MemoryFileSystem();
  await fs.mkdir("/pics", { recursive: true });
  await fs.mkdir("/pics%w", { recursive: true });
  await fs.writeFile(path.startsWith("/") ? path : `/${path}`, bytes);
  const files = new Map([[path, bytes]]);
  const format = "%d|%[directory]|%[basename]|%[extension]|%f|%t|%e|%i|%[DIRECTORY]|%%d|%%[basename]";
  const filename = extension ? `${basename}.${extension}` : basename;
  const expected = { exitCode: 0, stdout: `${directory}|${directory}|${basename}|${extension}|${filename}|${basename}|${extension}|${path}|${directory}|%d|%[basename]`, stderr: "" };
  for (const inputPath of [path, `PNG:${path}`]) {
    const args = ["-format", format, inputPath];
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
  }
  expect(await runMagickCli([path, "-format", `${format}\n`, "info:"], files)).toEqual({ ...expected, stdout: `${directory}|${directory}|${basename}|${extension}|${filename}|${basename}|${extension}||${directory}|%d|%[basename]\n` });
});
