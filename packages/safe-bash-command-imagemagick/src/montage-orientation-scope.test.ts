import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const colors: Record<string, number[]> = {
  R: [255, 0, 0], G: [0, 255, 0], B: [0, 0, 255], Y: [255, 255, 0],
  K: [0, 0, 0], W: [255, 255, 255], C: [0, 255, 255], M: [255, 0, 255]
};

// ImageMagick 7.1.2-35 Q16-HDRI reference pixels, in row order.
for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  it.each([
    { inputs: ["a.ppm", "-flip", "b.ppm"], pixels: "RGCMBYKW" },
    { inputs: ["a.ppm", "-flop", "b.ppm"], pixels: "RGWKBYMC" },
    { inputs: ["a.ppm", "-transpose", "b.ppm"], pixels: "RGKCBYWM" },
    { inputs: ["a.ppm", "b.ppm", "-flip"], pixels: "BYCMRGKW" },
    { inputs: ["a.ppm", "b.ppm", "-flop"], pixels: "GRWKYBMC" },
    { inputs: ["a.ppm", "b.ppm", "-transpose"], pixels: "RBKCGYWM" },
    { inputs: ["-flip", "a.ppm", "b.ppm"], pixels: "BYCMRGKW" },
    { inputs: ["-flop", "a.ppm", "b.ppm"], pixels: "GRWKYBMC" },
    { inputs: ["-transpose", "a.ppm", "b.ppm"], pixels: "RBKCGYWM" },
    { inputs: ["a.ppm", "-flip", "b.ppm", "a.ppm"], pixels: "RGCMBYBYKWRG" },
    { inputs: ["a.ppm", "-flip", "b.ppm", "-flop", "a.ppm"], pixels: "BYKWYBRGCMGR" },
    { inputs: ["a.ppm", "-flip", "b.ppm", "-geometry", "+0+0", "a.ppm"], pixels: "BYKWBYRGCMRG" },
    { inputs: ["a.ppm", "-flip", "b.ppm", "-flip"], pixels: "BYKWRGCM" },
    { inputs: ["a.ppm", "-flip", "b.ppm", "-reverse"], pixels: "CMRGKWBY" },
    { inputs: ["a.ppm", "-flip", "b.ppm", "-swap", "0,1"], pixels: "CMRGKWBY" },
    { inputs: ["a.ppm", "-flip", "b.ppm", "-insert", "0"], pixels: "CMRGKWBY" },
    { inputs: ["a.ppm", "-flip", "b.ppm", "-delete", "0"], pixels: "CMKW" },
    { inputs: ["a.ppm", "-flip", "b.ppm", "-duplicate", "1,0"], pixels: "RGCMRGBYKWBY" },
    { inputs: ["a.ppm", "-flip", "b.ppm", "+clone"], pixels: "RGCMKWBYKWCM" },
    { inputs: ["a.ppm", "(", "b.ppm", "-flip", ")"], pixels: "RGCMBYKW" },
    { inputs: ["a.ppm", "-flip", "(", "b.ppm", ")"], pixels: "BYKWRGCM" },
    { inputs: ["-flip", "(", "a.ppm", ")", "b.ppm"], pixels: "BYKWRGCM" }
  ])(`scopes montage orientations via ${mode}: $inputs`, async ({ inputs, pixels }) => {
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    for (const [name, values] of [["a.ppm", "RGBY"], ["b.ppm", "KWCM"]] as const) {
      const bytes = new Uint8Array([...new TextEncoder().encode("P6\n2 2\n255\n"), ...Array.from(values, color => colors[color]!).flat()]);
      files.set(name, bytes);
      await fs.writeFile(`/${name}`, bytes);
    }
    const args = ["-geometry", "+0+0", "-tile", "x1", ...inputs, "-depth", "8", "ppm:-"];
    let output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const chunks: Uint8Array[] = [];
      const stderr: unknown[] = [];
      const context: CommandContext = {
        command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk); } },
        stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
      };
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      expect((await command.execute(context)).exitCode).toBe(0);
      expect(stderr).toEqual([]);
      output = Buffer.concat(chunks);
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    const image = decodeImage(output);
    expect([image.width, image.height]).toEqual([pixels.length / 2, 2]);
    expect(Array.from(image.data)).toEqual(Array.from(pixels, color => [...colors[color]!, 255]).flat());
  });
}
