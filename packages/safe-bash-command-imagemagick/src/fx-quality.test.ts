import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync, runMagickCli, runMagickCliSync } from "./index.js";

const tile = Buffer.from("P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n0 0 0  255 255 255  128 64 32\n");
// ImageMagick 7.1.2-35: magick tile.ppm -quality 83 photo.jpg
const photo = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUEBAUEAwUFBAUGBgUGCA4JCAcHCBEMDQoOFBEVFBMRExMWGB8bFhceFxMTGyUcHiAhIyMjFRomKSYiKR8iIyL/2wBDAQYGBggHCBAJCRAiFhMWIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiL/wAARCAACAAMDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAbEAADAAMBAQAAAAAAAAAAAAABAgMABAVBUf/EABUBAQEAAAAAAAAAAAAAAAAAAAQG/8QAGxEAAgEFAAAAAAAAAAAAAAAAAAECAwU0crH/2gAMAwEAAhEDEQA/AJ53NHUq/HrXVg9K8Llu7tMEszaECzE+kkkk/TjGMtbZhUdY8QlH/9k=", "base64");

for (const mode of ["buffered", "retained", "sync", "identify", "magick"] as const) {
  it.each([
    { path: "/tile.ppm", bytes: tile, stdout: "0|92" },
    { path: "/photo.jpg", bytes: photo, stdout: "83|83" },
    { path: "/progressive.jpg", bytes: sharp(tile).jpeg({ quality: 83, progressive: true }).toBufferSync(), stdout: "83|83" }
  ])(`reports stored FX quality independently of the %Q fallback (${mode}): $path`, async ({ path, bytes, stdout }) => {
    const files = new Map([[path, bytes]]), fs = new MemoryFileSystem();
    await fs.writeFile(path, bytes);
    const args = ["-format", "%[fx:quality]|%Q", path];
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
}

for (const mode of ["buffered", "retained", "sync"] as const) {
  it("uses stored quality in pixel FX arithmetic (" + mode + ")", async () => {
    const files = new Map([["/photo.jpg", photo]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/photo.jpg", photo);
    const args = ["/photo.jpg", "-fx", "quality/100", "/out.png"];
    const result = mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
    expect(Array.from(decodeImage(output).data)).toEqual(Array.from({ length: 6 }, () => [212, 212, 212, 255]).flat());
  });
}
