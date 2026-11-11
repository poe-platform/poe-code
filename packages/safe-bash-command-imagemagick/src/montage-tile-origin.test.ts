import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  async function montage(options: string[], inputs = ["/a.ppm"]) {
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    for (const [name, width, height, color] of [
      ["a", 3, 2, [255, 0, 0]], ["b", 2, 4, [0, 255, 0]], ["c", 1, 3, [0, 0, 255]]
    ] as const) {
      const bytes = Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), Buffer.from(Array.from({ length: width * height }, () => color).flat())]);
      files.set(`/${name}.ppm`, bytes);
      await fs.writeFile(`/${name}.ppm`, bytes);
    }
    const args = [...inputs, ...options];
    if (mode === "command") {
      const argumentValues = createCommandArguments(["montage", ...args]);
      const stdout: Uint8Array[] = [], stderr: unknown[] = [];
      const result = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk); } },
        stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
      });
      expect(result.exitCode, String(stderr)).toBe(0);
      expect(stderr).toEqual([]);
      return { output: Buffer.concat(stdout), read: (name: string) => fs.readFile(name) };
    }
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    return { output: result.stdoutBytes!, read: async (name: string) => mode === "retained" ? fs.readFile(name) : files.get(name)! };
  }

  it.each([
    ["1x1+2+1", 8, 7, "2f89b444151f5348686d118c499ef4f06dda101c6936dda363526ea2ac6c18a5"],
    ["1x1+0+2", 6, 8, "c966001d8819f6a9c30125dadbffdddb9c496abc371d87560dfcc9aea7433b23"],
    ["1x1", 6, 6, "4c594dcbfc08079d28aaf32c22993685683603dbf88fd1396c51703528114ffd"]
  ] as const)(`${mode}: matches native PPM for -tile %s`, async (tile, width, height, hash) => {
    const { output } = await montage(["-tile", tile, "-geometry", "4x4+1+1", "-gravity", "NorthWest", "-depth", "8", "ppm:-"]);
    expect(decodeImage(output)).toMatchObject({ width, height });
    expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
  });

  for (const grid of ["2x1", "2x2"]) it.each([
    ["fixed cells", ["-geometry", "4x4+1+1"]],
    ["variable cells", ["-geometry", "+1+1"]],
    ["transformed variable cells", ["-geometry", "+1+1", "-flip"]],
    ["frames", ["-geometry", "4x4+1+1", "-frame", "1x1+0+0"]],
    ["frame shadows", ["-geometry", "4x4+1+1", "-frame", "1x1+0+0", "-shadow"]]
  ] as const)(`${mode}: shifts every ${grid} page with %s independently of padding`, async (_name, options) => {
    const inputs = ["/a.ppm", "/b.ppm", "/c.ppm"];
    const shifted = await montage([...options, "-tile", `${grid}+2+1`, "-depth", "8", "+adjoin", "/shifted.miff"], inputs);
    const pages = await montage([...options, "-tile", grid, "-depth", "8", "+adjoin", "/base.miff"], inputs);
    for (let page = 0; page < (grid === "2x1" ? 2 : 1); page++) {
      const base = decodeImage(await pages.read(grid === "2x1" ? `/base-${page}.miff` : "/base.miff"));
      const image = decodeImage(await shifted.read(grid === "2x1" ? `/shifted-${page}.miff` : "/shifted.miff"));
      expect([image.width, image.height]).toEqual([base.width + 2, base.height + 1]);
      const expected = new Uint8Array(image.width * image.height * 4).fill(255);
      for (let y = 0; y < base.height; y++) expected.set(base.data.subarray(y * base.width * 4, (y + 1) * base.width * 4), ((y + 1) * image.width + 2) * 4);
      expect(image.data).toEqual(expected);
      expect(image.montage?.geometry).toBe(base.montage!.geometry.replace("+0+0", "+2+1"));
    }
  });

  it(`${mode}: resets a previous origin when -tile has no offsets`, async () => {
    const { output } = await montage(["-tile", "1x1+2+1", "-tile", "1x1", "-geometry", "4x4+1+1", "-gravity", "NorthWest", "-depth", "8", "ppm:-"]);
    expect(createHash("sha256").update(output).digest("hex")).toBe("4c594dcbfc08079d28aaf32c22993685683603dbf88fd1396c51703528114ffd");
  });
}
