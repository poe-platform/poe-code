import { createHash } from "node:crypto";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete RGB8 rasters.
for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  it.each([
    { options: ["-quantize", "Gray", "-colors", "4"], colors: 3, hash: "9499ca9095f2df735da46b4ff7983b84ff321cd774c00c7fa7bd7c3fd299fb53" },
    { options: ["-quantize", "Lab", "-colors", "4"], colors: 4, hash: "6b75005232a6ecfa7668a062d665ea097053709693d69c01ff4da412d9097cf6" },
    { options: ["-quantize", "Lab"], colors: 64, hash: "cd1ccfac496edc6d0eb5a4cbb5d74e67d6f4b032ba39c5335b8a50f15f7a75f5" },
    { options: [], colors: 64, hash: "cd1ccfac496edc6d0eb5a4cbb5d74e67d6f4b032ba39c5335b8a50f15f7a75f5" },
    { options: ["-colors", "4"], colors: 4, hash: "43109c15ed283711e4e4f73b41c3a57f10e95ab9cb7f62bf76ad77c7f7fc7fff" },
    { options: ["-colors", "4", "-quantize", "Gray"], colors: 4, hash: "43109c15ed283711e4e4f73b41c3a57f10e95ab9cb7f62bf76ad77c7f7fc7fff" },
    { options: ["-quantize", "Lab", "+quantize", "-colors", "4"], colors: 4, hash: "43109c15ed283711e4e4f73b41c3a57f10e95ab9cb7f62bf76ad77c7f7fc7fff" },
    { options: ["-quantize", "Gray", "-colors", "4", "+quantize"], colors: 3, hash: "9499ca9095f2df735da46b4ff7983b84ff321cd774c00c7fa7bd7c3fd299fb53" },
  ])(`${mode}: selects tile quantization colorspace for $options`, async ({ options, colors, hash }) => {
    const pixels = Uint8Array.from({ length: 16 * 4 * 3 }, (_, index) => {
      const x = Math.floor(index / 3) % 16, y = Math.floor(index / 48);
      return [x * 17, (x * 11 + y * 43) % 256, 255 - x * 13][index % 3]!;
    });
    const source = Buffer.concat([Buffer.from("P6\n16 4\n255\n"), pixels]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", source);
    const args = ["/in.ppm", ...options, "-tile", "1x1", "-geometry", "+0+0", "-depth", "8", "rgb:-"];
    let output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const result = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      output = Buffer.concat(chunks);
    } else {
      const files = new Map([["/in.ppm", source]]);
      const result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    expect(output).toHaveLength(192);
    expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    expect(new Set(Array.from({ length: 64 }, (_, index) => output.slice(index * 3, index * 3 + 3).join(","))).size).toBe(colors);
  });
}

for (const mode of ["sync", "buffered", "retained"] as const) {
  it.each([
    { args: ["xc:red", "-quantize"], error: "missing argument for -quantize" },
    { args: ["xc:red", "-quantize", "invalid", "/out.rgb"], error: "unrecognized colorspace '-quantize' 'invalid'" },
    { args: ["xc:red", "-colors"], error: "missing argument for -colors" },
  ])(`${mode}: rejects invalid quantization without replacing output: $args`, async ({ args, error }) => {
    const original = new Uint8Array([1, 2, 3]);
    const files = new Map([["/out.rgb", original]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out.rgb", original);
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 1, stdout: "", stderr: `montage: ${error}\n` });
    expect(mode === "retained" ? await fs.readFile("/out.rgb") : files.get("/out.rgb")).toEqual(original);
  });
}
