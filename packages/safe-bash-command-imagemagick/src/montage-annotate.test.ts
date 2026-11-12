import { decodeImage } from "@poe-code/image-ast";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  it.each([0, 1])(`${mode}: annotates each tiny tile at x=%i without expanding the sheet`, async x => {
    const args = ["-size", "3x3", "xc:black", "xc:blue", "-fill", "red", "-pointsize", "3", "-annotate", `+${x}+3`, "I", "-tile", "2x1", "-geometry", "+0+0", "-depth", "8", "ppm:-"];
    const fs = new MemoryFileSystem();

    let output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const chunks: Uint8Array[] = [], stderr: unknown[] = [];
      const context: CommandContext = {
        command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk); } },
        stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
      };
      const result = await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute(context);
      expect(stderr).toEqual([]);
      expect(result.exitCode).toBe(0);
      output = Buffer.concat(chunks);
    } else {
      const files = new Map<string, Uint8Array>();
      const result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    const image = decodeImage(output);
    expect([image.width, image.height]).toEqual([6, 3]);
    const marked: number[][] = [[], []];
    for (let y = 0; y < 3; y++) for (let column = 0; column < 6; column++) {
      const pixel = (y * 6 + column) * 4;
      const tile = Math.floor(column / 3);
      if (image.data[pixel]! > 0) {
        marked[tile]!.push(y * 3 + column % 3 - x);
        expect(column % 3).toBeGreaterThanOrEqual(x);
        expect(image.data[pixel + 1]).toBe(0);
      } else expect(Array.from(image.data.slice(pixel, pixel + 3))).toEqual(tile === 0 ? [0, 0, 0] : [0, 0, 255]);
    }
    expect(marked[0]!.length).toBeGreaterThan(0);
    expect(marked[0]).toEqual(marked[1]);
    expect(marked[0]).toContain(6);
  });
}

for (const retained of [false, true]) {
  it(`keeps annotation settings and parenthesized tile scope (retained=${retained})`, async () => {
    const args = ["-size", "3x3", "(", "xc:black", "-fill", "red", "-pointsize", "3", "-annotate", "+0+3", "I", ")", "xc:blue", "-fill", "green", "-pointsize", "20", "-tile", "2x1", "-geometry", "+0+0", "-depth", "8", "ppm:-"];
    const result = await runMontageCli(args, retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map());
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const image = decodeImage(result.stdoutBytes!);
    expect([image.width, image.height]).toEqual([6, 3]);
    expect(Array.from(image.data.slice(6 * 4, 6 * 4 + 3))).toEqual([255, 0, 0]);
    for (let y = 0; y < 3; y++) for (let x = 3; x < 6; x++)
      expect(Array.from(image.data.slice((y * 6 + x) * 4, (y * 6 + x) * 4 + 3))).toEqual([0, 0, 255]);
  });

  it.each([["-annotate"], ["-annotate", "+0+3"], ["-annotate", "bad", "I"]].map(annotation => ({ annotation })))(`rejects invalid annotation without replacing output (retained=${retained}): %j`, async ({ annotation }) => {
    const fs = new MemoryFileSystem(), original = new Uint8Array([1, 2, 3]);
    await fs.writeFile("/sheet.ppm", original);
    const files = new Map([["sheet.ppm", original]]);
    const args = ["-size", "3x3", "xc:black", ...annotation];
    if (annotation.length === 3) args.push("sheet.ppm");
    const result = await runMontageCli(args, retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("argument for");
    expect(retained ? await fs.readFile("/sheet.ppm") : files.get("sheet.ppm")).toEqual(original);
  });
}
