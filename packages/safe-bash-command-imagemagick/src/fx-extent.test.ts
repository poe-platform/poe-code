import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync, runMagickCli, runMagickCliSync } from "./index.js";

const tile = Buffer.from("P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n0 0 0  255 255 255  128 64 32\n");
// ImageMagick 7.1.2-35 Q16-HDRI: magick tile.ppm -quality 83 photo.jpg.
const photo = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUEBAUEAwUFBAUGBgUGCA4JCAcHCBEMDQoOFBEVFBMRExMWGB8bFhceFxMTGyUcHiAhIyMjFRomKSYiKR8iIyL/2wBDAQYGBggHCBAJCRAiFhMWIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiL/wAARCAACAAMDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAbEAADAAMBAQAAAAAAAAAAAAABAgMABAVBUf/EABUBAQEAAAAAAAAAAAAAAAAAAAQG/8QAGxEAAgEFAAAAAAAAAAAAAAAAAAECAwU0crH/2gAMAwEAAhEDEQA/AJ53NHUq/HrXVg9K8Llu7tMEszaECzE+kkkk/TjGMtbZhUdY8QlH/9k=", "base64");
const format = "%[fx:extent]|%b|%[fx:extent/2]";

for (const mode of ["buffered", "retained", "sync", "identify", "magick"] as const) {
  it.each([
    { path: "/tile.ppm", bytes: tile },
    { path: "/photo.jpg", bytes: photo }
  ])(`reports encoded input bytes through FX extent (${mode}): $path`, async ({ path, bytes }) => {
    const files = new Map([[path, bytes]]), fs = new MemoryFileSystem();
    await fs.writeFile(path, bytes);
    const args = ["-format", format, path];
    let result;
    if (mode === "sync") result = runIdentifyCliSync(args, files);
    else if (mode === "buffered" || mode === "retained") result = await runIdentifyCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    else {
      const command = mode === "magick" ? createMagickCommand() : createIdentifyCommand();
      const argumentValues = createCommandArguments([...(mode === "magick" ? ["identify"] : []), ...args]);
      let stdout = "", stderr = "";
      const status = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      result = { ...status, stdout, stderr };
    }
    expect(result).toEqual({ exitCode: 0, stdout: `${bytes.length}|${bytes.length}B|${bytes.length / 2}`, stderr: "" });
  });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
  it(`keeps input extent after resizing and reports zero for generated images (${mode})`, async () => {
    const files = new Map([["/tile.ppm", tile]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/tile.ppm", tile);
    const args = ["/tile.ppm", "-resize", "1x1!", "xc:red", "-format", "%[fx:extent]|%b;\n", "info:"];
    const result = mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stdout: "67|67B;\n0|0B;\n", stderr: "" });
  });

  it(`selects each input's encoded extent in pixel FX arithmetic (${mode})`, async () => {
    const files = new Map([["/tile.ppm", tile], ["/photo.jpg", photo]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/tile.ppm", tile);
    await filesystem.writeFile("/photo.jpg", photo);
    const args = ["/tile.ppm", "/photo.jpg", "-fx", `u[0].extent+v.extent==${tile.length + photo.length}?0.5:0`, "/out.png"];
    const result = mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
    expect(Array.from(decodeImage(output).data)).toEqual(Array.from({ length: 6 }, () => [128, 128, 128, 255]).flat());
  });
}
