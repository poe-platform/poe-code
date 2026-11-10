import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

const fixtures = [
  { path: "/tile.ppm", width: 3, height: 2, mean: "0.382135", bytes: new TextEncoder().encode("P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n0 0 0  255 255 255  128 64 32\n") },
  { path: "/solid.png", width: 2, height: 1, mean: "0.376471", bytes: encodeImage({
    width: 2, height: 1, data: Uint8Array.from([64, 96, 128, 255, 64, 96, 128, 255]),
    format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false,
  }, { format: "png" }).data },
];

for (const retained of [false, true]) for (const identify of [false, true]) {
  it.each(fixtures)(`honors image qualifiers in FX statistics for $path (retained=${retained}, identify=${identify})`, async ({ path, bytes, mean, width, height }) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile(path, bytes);
    const expressions = ["u.mean", "mean", "u.w", "u.h",
      ...["mean", "standard_deviation", "minima", "maxima", "median"].flatMap(statistic =>
        ["", ".r", ".g", ".b"].map(channel => `u.${statistic}${channel}-${statistic}${channel}`))];
    const format = expressions.map(expression => `%[fx:${expression}]`).join("|");
    const args = identify ? ["identify", "-format", format, path] : [path, "-format", format, "info:"];
    let result;
    if (retained) {
      const argumentValues = createCommandArguments(args);
      let stdout = "", stderr = "";
      const status = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(), registerCleanup() {},
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      });
      result = { ...status, stdout, stderr };
    } else {
      result = await runMagickCli(args, new Map([[path, bytes]]));
    }
    expect(result).toEqual({ exitCode: 0, stdout: [mean, mean, width, height, ...Array(20).fill(0)].join("|"), stderr: "" });
  });
}

for (const retained of [false, true]) {
  it(`evaluates qualified statistics in pixel FX (retained=${retained})`, async () => {
    const { path, bytes } = fixtures[1]!;
    const fs = new MemoryFileSystem();
    await fs.writeFile(path, bytes);
    const files = new Map([[path, bytes]]);
    const result = await runMagickCli([path, "-fx", "u.mean", "/result.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect(Array.from(decodeImage(retained ? await fs.readFile("/result.png") : files.get("/result.png")!).data))
      .toEqual([0, 96, 96, 255, 0, 96, 96, 255]);
  });
}
