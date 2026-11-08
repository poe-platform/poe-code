import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained"] as const)
it.each(["south", "southeast", "east"])("keeps positive %s annotation offsets inside the image via " + mode, async gravity => {
  const bytes = await sharp({ create: { width: 120, height: 80, channels: 3, background: "white" } }).png().toBuffer();
  const files = new Map([["input.png", bytes]]), fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  const result = await runConvertCli(["input.png", "-fill", "red", "-pointsize", "18", "-gravity", gravity, "-annotate", "+10+10", "AB", "out.png"], mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  const image = decodeImage(mode === "buffered" ? files.get("out.png")! : await fs.readFile("/out.png"));
  const xs: number[] = [], ys: number[] = [];
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const offset = (y * image.width + x) * 4;
    if (image.data[offset]! > 200 && image.data[offset + 1]! < 100) { xs.push(x); ys.push(y); }
  }
  expect(ys.length).toBeGreaterThan(20);
  expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(8);
  if (gravity.includes("south")) expect(Math.max(...ys)).toBeLessThan(70);
  if (gravity.includes("east")) expect(Math.max(...xs)).toBeLessThan(112);
});
