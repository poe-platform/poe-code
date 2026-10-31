import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMontageCli } from "./index.js";

it.each(["buffered", "retained"] as const)("renders montage filename labels below the tiles via %s", async mode => {
  const bytes = await sharp({ create: { width: 80, height: 40, channels: 3, background: "red" } }).png().toBuffer();
  const files = new Map([["first.png", bytes], ["second.png", bytes]]);
  const fs = new MemoryFileSystem();
  for (const [name, data] of files) await fs.writeFile("/" + name, data);
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file montage I/O forbidden"); };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await runMontageCli(["-label", "%f", "first.png", "second.png", "-tile", "2x1", "-geometry", "80x40+4+4", "out.png"], mode === "buffered" ? files : { filesystem, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  const image = decodeImage(mode === "buffered" ? files.get("out.png")! : await fs.readFile("/out.png"));
  expect(image.width).toBe(176);
  expect(image.height).toBeGreaterThan(48);
  for (const start of [0, 88]) {
    let ink = 0;
    for (let y = 44; y < image.height; y++) for (let x = start; x < start + 88; x++) {
      const offset = (y * image.width + x) * 4;
      if (image.data[offset]! < 100 && image.data[offset + 1]! < 100 && image.data[offset + 2]! < 100) ink++;
    }
    expect(ink).toBeGreaterThan(10);
  }
});

it("expands filename labels once and preserves labels for each input", async () => {
  const bytes = await sharp({ create: { width: 160, height: 40, channels: 3, background: "red" } }).png().toBuffer();
  const files = new Map([["literal%f.png", bytes], ["second.png", bytes]]);
  for (const [label, output] of [["%f", "expanded.png"], ["literal%%f.png", "literal.png"]]) {
    expect((await runMontageCli(["-label", label!, "literal%f.png", "+label", "second.png", "-tile", "2x1", "-pointsize", "18", "-fill", "blue", output!], files)).exitCode).toBe(0);
  }
  expect(decodeImage(files.get("expanded.png")!)).toEqual(decodeImage(files.get("literal.png")!));
  const image = decodeImage(files.get("expanded.png")!);
  const ink = [0, 0];
  for (let y = 42; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const offset = (y * image.width + x) * 4;
    if (image.data[offset]! < 100 && image.data[offset + 2]! > 200) ink[Math.floor(x / (image.width / 2))]!++;
  }
  expect(ink[0]).toBeGreaterThan(10);
  expect(ink[1]).toBe(0);
});
