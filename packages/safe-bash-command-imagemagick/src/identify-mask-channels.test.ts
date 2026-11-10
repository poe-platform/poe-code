import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2: five distinct RGBA colors, including transparency.
const colors = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAYAAAABCAYAAAD9yd/wAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMDk6Mzc6MTUrMDA6MDBTKCewAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDA5OjM3OjE1KzAwOjAwInWfDAAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QwOTozNzoxNSswMDowMHVgvtMAAAAhSURBVAjXY0hhYGBgSGFg4BKRa+ASkfvPJSLXwMDw/z8ALVkFeoo1BV0AAAAASUVORK5CYII=", "base64");
const mask = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAYAAAABAQAAAADVsuJdAAAAAmJLR0QAAd2KE6QAAAAHdElNRQfqCwcJJQ/mkW0VAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDA5OjM3OjE1KzAwOjAwUygnsAAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QwOTozNzoxNSswMDowMCJ1nwwAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMDk6Mzc6MTUrMDA6MDB1YL7TAAAACklEQVQI12PQAAAAKgApwb9MMQAAAABJRU5ErkJggg==", "base64");

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([
    { options: [], channels: 4 },
    { options: ["-read-mask", "/mask.png"], channels: 5 },
    { options: ["-write-mask", "/mask.png"], channels: 5 },
    { options: ["-read-mask", "/mask.png", "-write-mask", "/mask.png"], channels: 6 },
    { options: ["-read-mask", "/mask.png", "+read-mask"], channels: 4 },
    { options: ["-write-mask", "/mask.png", "+write-mask"], channels: 4 },
    { options: ["-read-mask", "/mask.png", "-write-mask", "/mask.png", "+read-mask"], channels: 5 },
    { options: ["-read-mask", "/mask.png", "-write-mask", "/mask.png", "+write-mask"], channels: 5 },
    { options: ["-read-mask", "/mask.png", "-write-mask", "/mask.png", "+read-mask", "+write-mask"], channels: 4 },
    { options: ["-read-mask", "/mask.png", "-read-mask", "/mask.png"], channels: 5 },
    { options: ["-write-mask", "/mask.png", "-write-mask", "/mask.png"], channels: 5 },
    { options: ["-clip-mask", "/mask.png"], channels: 5 },
    { options: ["-clip-mask", "/mask.png", "+clip-mask"], channels: 4 }
  ])(`counts attached mask planes without changing color count (${mode}): $options`, async ({ options, channels }) => {
    const files = new Map([["/colors.png", colors], ["/mask.png", mask]]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
    const args = ["/colors.png", ...options, "-format", "%[channels]|%k", "info:"];
    let result;
    if (mode === "command") {
      const argumentValues = createCommandArguments(args);
      let stdout = "", stderr = "";
      const status = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs: filesystem, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      result = { ...status, stdout, stderr };
    } else {
      result = mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    }
    expect(result).toEqual({ exitCode: 0, stdout: `srgba ${channels}.0|5`, stderr: "" });
  });
}
