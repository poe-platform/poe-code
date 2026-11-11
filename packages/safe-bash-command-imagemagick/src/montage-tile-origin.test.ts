import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["command", "montage", "retained", "buffered", "sync"] as const) {
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
    if (mode === "command" || mode === "montage") {
      const argumentValues = createCommandArguments(mode === "command" ? ["montage", ...args] : args);
      const stdout: Uint8Array[] = [], stderr: unknown[] = [];
      const result = await (mode === "command" ? createMagickCommand() : createMontageCommand()).execute({
        command: mode === "command" ? "magick" : "montage", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
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

  it.each([
    ["fixed cells", ["-geometry", "4x4+1+1"]],
    ["variable cells", ["-geometry", "+1+1"]],
    ["transformed variable cells", ["-geometry", "+1+1", "-flip"]],
    ["frames", ["-geometry", "4x4+1+1", "-frame", "1x1+0+0"]],
    ["frame shadows", ["-geometry", "4x4+1+1", "-frame", "1x1+0+0", "-shadow"]]
  ] as const)(`${mode}: shifts every single-row page with %s independently of padding`, async (_name, options) => {
    const inputs = ["/a.ppm", "/b.ppm", "/c.ppm"];
    const shifted = await montage([...options, "-tile", "2x1+2+1", "-depth", "8", "+adjoin", "/shifted.miff"], inputs);
    const pages = await montage([...options, "-tile", "2x1", "-depth", "8", "+adjoin", "/base.miff"], inputs);
    for (let page = 0; page < 2; page++) {
      const base = decodeImage(await pages.read(`/base-${page}.miff`));
      const image = decodeImage(await shifted.read(`/shifted-${page}.miff`));
      expect([image.width, image.height]).toEqual([base.width + 2, base.height + 1]);
      const expected = new Uint8Array(image.width * image.height * 4).fill(255);
      for (let y = 0; y < base.height; y++) expected.set(base.data.subarray(y * base.width * 4, (y + 1) * base.width * 4), ((y + 1) * image.width + 2) * 4);
      expect(image.data).toEqual(expected);
      expect(image.montage?.geometry).toBe(base.montage!.geometry.replace("+0+0", "+2+1"));
    }
  });

  // Native ImageMagick 7.1.2-35 Q16-HDRI P6 output, including the second row.
  it.each([
    ["fixed cells", ["-geometry", "4x4+1+1"], "0678eb40d6cc2289b592e8eac12764def8ab2c375d01b7c885fe5fe66fdcd9b0"],
    ["variable cells", ["-geometry", "+1+1"], "a6d20fc311ff5450147f595de679739a1e3e2e02242c34dd15c2b00a12641981"],
    ["transformed variable cells", ["-geometry", "+1+1", "-flip"], "a6d20fc311ff5450147f595de679739a1e3e2e02242c34dd15c2b00a12641981"],
    ["frames", ["-geometry", "4x4+1+1", "-frame", "1x1+0+0"], "3751213f7ecf7f6edc1b1c1e6879a2a86abff0556bcf699dd57db9b0d0ce4248"]
  ] as const)(`${mode}: resets the horizontal origin after the first row with %s`, async (_name, options, hash) => {
    const { output } = await montage([...options, "-tile", "2x2+2+1", "-depth", "8", "ppm:-"], ["/a.ppm", "/b.ppm", "/c.ppm"]);
    expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
  });

  it(`${mode}: resets the horizontal origin for shadowed frames`, async () => {
    const { output } = await montage(["-geometry", "4x4+1+1", "-frame", "1x1+0+0", "-shadow", "-tile", "2x2+2+1", "-depth", "8", "ppm:-"], ["/a.ppm", "/b.ppm", "/c.ppm"]);
    const image = decodeImage(output);
    expect([image.width, image.height]).toEqual([22, 25]);
    const red: number[] = [], blue: number[] = [];
    for (let pixel = 0; pixel < image.width * image.height; pixel++) {
      const [r, g, b] = image.data.subarray(pixel * 4, pixel * 4 + 3);
      if (r === 255 && g === 0 && b === 0) red.push(pixel);
      if (r === 0 && g === 0 && b === 255) blue.push(pixel);
    }
    expect(red).toEqual([92, 93, 94, 95, 114, 115, 116, 117, 136, 137, 138, 139]);
    expect(blue).toEqual([334, 356, 378, 400]);
  });

  it.each([
    ["1x2+2+0", 3, 2, "..RB.."],
    ["1x2", 1, 2, "RB"],
    ["2x1+2+0", 4, 1, "..RB"]
  ] as const)(`${mode}: matches every pixel for -tile %s`, async (tile, width, height, pixels) => {
    const { output } = await montage(["-tile", tile, "-geometry", "+0+0", "-depth", "8", "ppm:-"], ["-size", "1x1", "xc:red", "xc:blue"]);
    const colors = { ".": [255, 255, 255], R: [255, 0, 0], B: [0, 0, 255] };
    expect(Buffer.from(output)).toEqual(Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), Buffer.from([...pixels].flatMap(pixel => colors[pixel as keyof typeof colors]))]));
  });

  it(`${mode}: reapplies the horizontal origin only to the first row of each page`, async () => {
    const { read } = await montage(["-tile", "1x2+2+0", "-geometry", "+0+0", "-depth", "8", "+adjoin", "/page.ppm"], ["-size", "1x1", "xc:red", "xc:blue", "xc:red", "xc:blue"]);
    const expected = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from([255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255])]);
    for (const page of [0, 1]) expect(Buffer.from(await read(`/page-${page}.ppm`))).toEqual(expected);
  });

  it(`${mode}: resets a previous origin when -tile has no offsets`, async () => {
    const { output } = await montage(["-tile", "1x1+2+1", "-tile", "1x1", "-geometry", "4x4+1+1", "-gravity", "NorthWest", "-depth", "8", "ppm:-"]);
    expect(createHash("sha256").update(output).digest("hex")).toBe("4c594dcbfc08079d28aaf32c22993685683603dbf88fd1396c51703528114ffd");
  });
}
