import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMontageCli } from "./index.js";

for (const retained of [false, true]) {
  it(`preserves explicit GIF delay and all frames (retained=${retained})`, async () => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const args = ["-delay", "100"];
    for (let i = 0; i < 6; i++) {
      const name = `thumb_${i}.png`;
      const bytes = await sharp({ create: { width: 4, height: 3, channels: 3, background: { r: i * 40, g: 0, b: 0 } } }).png().toBuffer();
      files.set(name, bytes); await fs.writeFile("/" + name, bytes); args.push(name);
    }
    args.push("-loop", "0", "preview.gif");
    expect(await runMagickCli(args, retained ? { filesystem: fs, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    const bytes = retained ? await fs.readFile("/preview.gif") : files.get("preview.gif")!;
    expect(await sharp(bytes, { animated: true }).metadata()).toMatchObject({ pages: 6, delay: [1000, 1000, 1000, 1000, 1000, 1000], loop: 0 });
  });
  it(`consumes montage thumbnail geometry (retained=${retained})`, async () => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const bytes = await sharp({ create: { width: 8, height: 6, channels: 3, background: "red" } }).png().toBuffer();
    files.set("in.png", bytes); await fs.writeFile("/in.png", bytes);
    expect(await runMontageCli(["-thumbnail", "4x3", "-tile", "1x1", "in.png", "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    expect(decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!)).toMatchObject({ width: 8, height: 7 });
  });
}
