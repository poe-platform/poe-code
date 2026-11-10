import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runIdentifyCli, runIdentifyCliSync, runMagickCli, runMagickCliSync } from "./index.js";

const tile = new TextEncoder().encode("P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n0 0 0  255 255 255  128 64 32\n");
const format = "%[fx:page.width]|%[fx:page.height]|%[fx:page.x]|%[fx:page.y]|%w|%h";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
  it.each([
    { canvas: undefined, expected: "3|2|0|0|3|2" },
    { canvas: { width: 9, height: 7, x: 2, y: 1 }, expected: "9|7|2|1|3|2" },
    { canvas: { width: 9, height: 7, x: -2, y: -1 }, expected: "9|7|-2|-1|3|2" }
  ])(`${mode}: FX reports page metadata independently of raster dimensions ($expected)`, async ({ canvas, expected }) => {
    // The first two outputs match ImageMagick 7.1.2-35 Q16-HDRI.
    const input = canvas ? encodeImage({ ...decodeImage(tile), virtualCanvas: canvas }, { format: "png" }).data : tile;
    const filename = canvas ? "/placed.png" : "/tile.ppm";
    const files = new Map([[filename, input]]), fs = new MemoryFileSystem();
    await fs.writeFile(filename, input);
    const args = ["-format", format, filename];
    let stdout = "", stderr = "";
    const argumentValues = createCommandArguments(["identify", ...args]);
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runIdentifyCliSync(args, files)
      : await runIdentifyCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect("stdout" in result ? result : { ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
  });

  it(`${mode}: -fx reads the current page after -repage without changing raster geometry`, async () => {
    const files = new Map([["/tile.ppm", tile]]), fs = new MemoryFileSystem();
    await fs.writeFile("/tile.ppm", tile);
    const args = ["/tile.ppm", "-repage", "9x7-2+1", "-channel", "R", "-fx", "(page.width+page.height+page.x+page.y)/30", "/out.png"];
    const argumentValues = createCommandArguments(args);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect("stderr" in result ? result : { ...result, stderr }).toMatchObject({ exitCode: 0, stderr: "" });
    const output = decodeImage(mode === "retained" || mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    expect([output.width, output.height]).toEqual([3, 2]);
    expect(output.virtualCanvas).toEqual({ width: 9, height: 7, x: -2, y: 1 });
    expect([...output.data]).toEqual([...decodeImage(tile).data].map((value, index) => index % 4 === 0 ? 128 : value));
  });
}
