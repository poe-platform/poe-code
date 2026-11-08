import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick"] as const) {
  it.each([
    { args: ["a.png", "b.png"], order: [0, 1] },
    { args: ["a.png", "b.png", "-reverse"], order: [1, 0] },
    { args: ["a.png", "b.png", "-reverse", "c.png"], order: [1, 0, 2] },
    { args: ["-reverse", "a.png", "b.png"], order: [0, 1] },
    { args: ["a.png", "b.png", "-reverse", "c.png", "-reverse"], order: [2, 0, 1] },
  ])(`reverses only preceding montage inputs via ${mode}: $args`, async ({ args, order }) => {
    const colors = [[255, 0, 0, 255], [0, 0, 255, 255], [0, 255, 0, 255]];
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    for (const [index, name] of ["a.png", "b.png", "c.png"].entries()) {
      const [r, g, b] = colors[index]!;
      const bytes = await sharp({ create: { width: 2, height: 1, channels: 4, background: { r: r!, g: g!, b: b!, alpha: 1 } } }).png().toBuffer();
      files.set(name, bytes);
      await fs.writeFile("/" + name, bytes);
    }
    const argv = ["-geometry", "+0+0", "-tile", `${order.length}x1`, ...args, "png:-"];
    const result = mode === "sync" ? runMontageCliSync(argv, files)
      : mode === "magick" ? await runMagickCli(["montage", ...argv], { filesystem: fs, cwd: "/" })
      : await runMontageCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const image = decodeImage(result.stdoutBytes!);
    expect([image.width, image.height]).toEqual([order.length * 2, 1]);
    expect(Array.from(image.data)).toEqual(order.flatMap(index => [...colors[index]!, ...colors[index]!]));
  });

  it(`keeps montage labels attached to reversed inputs via ${mode}`, async () => {
    const bytes = await sharp({ create: { width: 40, height: 2, channels: 3, background: "red" } }).png().toBuffer();
    const files = new Map([["a.png", bytes], ["b.png", bytes]]);
    const fs = new MemoryFileSystem();
    for (const [name, data] of files) await fs.writeFile("/" + name, data);
    const outputs = [];
    for (const args of [
      ["-label", "A", "a.png", "-label", "B", "b.png", "-reverse"],
      ["-label", "B", "b.png", "-label", "A", "a.png"],
    ]) {
      const argv = ["-geometry", "+0+0", "-tile", "2x1", ...args, "png:-"];
      const result = mode === "sync" ? runMontageCliSync(argv, files)
        : mode === "magick" ? await runMagickCli(["montage", ...argv], { filesystem: fs, cwd: "/" })
        : await runMontageCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      outputs.push(decodeImage(result.stdoutBytes!));
    }
    expect(outputs[0]).toEqual(outputs[1]);
  });
}
