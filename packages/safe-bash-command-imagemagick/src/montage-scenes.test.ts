import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const gif = encodeImage({
  width: 1, height: 3, pageHeight: 1, pages: 3,
  data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]),
  format: "gif", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
}, { format: "gif", pageHeight: 1 }).data;

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  it.each([
    { options: [], input: "/trio.gif", hex: "ff000000ff000000ff" },
    { options: ["-scenes", "0"], input: "/trio.gif", hex: "ff000000ff000000ff" },
    { options: ["-scenes", "1"], input: "/trio.gif", hex: "ff000000ff000000ff" },
    { options: [], input: "/trio.gif[1]", hex: "00ff00" },
    { options: ["-scenes", "1"], input: "/trio.gif[1]", hex: "00ff00" }
  ])(`${mode} preserves GIF frame selection with $options and $input`, async ({ options, input, hex }) => {
    const fs = new MemoryFileSystem(), files = new Map([["/trio.gif", gif]]);
    await fs.writeFile("/trio.gif", gif);
    const args = ["-geometry", "1x1+0+0", "-tile", "x1", ...options, input, "-depth", "8", "rgb:-"];
    let output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
      const result = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(chunk); } },
        stderr: { async write(chunk) { errors.push(chunk); } }
      });
      expect(Buffer.concat(errors).toString()).toBe("");
      expect(result.exitCode).toBe(0);
      output = Buffer.concat(chunks);
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    expect(Buffer.from(output).toString("hex")).toBe(hex);
  });

  it.each([[], ["-scenes", "4"], ["-scenes", "4-5"], ["-scenes", "1-2"]].map(options => ({ options })))(
    `${mode} preserves completed page numbering with trailing scene options $options`, async ({ options }) => {
      const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
      const args = ["xc:red", "xc:blue", "-tile", "1x1", "-geometry", "+0+0", ...options, "/page-%02d.png"];
      if (mode === "magick" || mode === "montage") {
        const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
        const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
        const errors: Uint8Array[] = [];
        const result = await command.execute({
          command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write() {} }, stderr: { async write(chunk) { errors.push(chunk); } }
        });
        expect(Buffer.concat(errors).toString()).toBe("");
        expect(result.exitCode).toBe(0);
      } else {
        const result = mode === "sync" ? runMontageCliSync(args, files)
          : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      }
      const retained = mode === "retained" || mode === "magick" || mode === "montage";
      const names = retained ? (await fs.readdir("/")).map(entry => `/${entry.name}`) : [...files.keys()];
      expect(names.sort()).toEqual(["/page-00.png", "/page-01.png"]);
      for (const [page, pixel] of [[255, 0, 0, 255], [0, 0, 255, 255]].entries()) {
        const name = `/page-0${page}.png`;
        const image = decodeImage(retained ? await fs.readFile(name) : files.get(name)!);
        expect(image.format).toBe("png");
        expect([image.width, image.height]).toEqual([1, 1]);
        expect(Array.from(image.data)).toEqual(pixel);
      }
    }
  );

  it.each([
    { options: ["-scenes"], error: "missing argument for -scenes" },
    { options: ["-scenes", ""], error: "invalid argument '' for -scenes" },
    { options: ["-scenes", "banana"], error: "invalid argument 'banana' for -scenes" }
  ])(`${mode} rejects malformed scene options without replacing output: $options`, async ({ options, error }) => {
    const original = new Uint8Array([1, 2, 3]);
    const fs = new MemoryFileSystem(), files = new Map([["/sheet.rgb", original]]);
    await fs.writeFile("/sheet.rgb", original);
    const args = ["xc:red", "/sheet.rgb", ...options];
    let result;
    if (mode === "magick" || mode === "montage") {
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
      const status = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(chunk); } },
        stderr: { async write(chunk) { errors.push(chunk); } }
      });
      result = { ...status, stdout: Buffer.concat(chunks).toString(), stderr: Buffer.concat(errors).toString() };
    } else result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 1, stdout: "", stderr: `montage: ${error}\n` });
    expect(files.get("/sheet.rgb")).toEqual(original);
    expect(await fs.readFile("/sheet.rgb")).toEqual(original);
  });
}
