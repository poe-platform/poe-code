import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMontageCli, runMontageCliSync } from "./index.js";

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

it.each(["buffered", "retained"] as const)("sets labels on previously read images via %s", async mode => {
  const bytes = await sharp({ create: { width: 160, height: 40, channels: 3, background: "red" } }).png().toBuffer();
  const files = new Map([["first.png", bytes], ["second.png", bytes]]);
  const fs = new MemoryFileSystem();
  for (const [name, data] of files) await fs.writeFile("/" + name, data);
  const input = mode === "buffered" ? files : { filesystem: fs, cwd: "/" };
  for (const args of [
    ["-label", "%f", "first.png", "second.png", "expected.png"],
    ["first.png", "second.png", "-set", "label", "%f", "actual.png"],
  ]) {
    const result = await runMontageCli([...args.slice(0, -1), "-tile", "2x1", "-geometry", "160x40+4+4", args.at(-1)!], input);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  }
  const read = async (name: string) => decodeImage(mode === "buffered" ? files.get(name)! : await fs.readFile("/" + name));
  expect(await read("actual.png")).toEqual(await read("expected.png"));
});

it.each(["buffered", "retained", "sync", "magick"] as const)("rejects unsupported label fonts without replacing output via %s", async mode => {
  const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } }).png().toBuffer();
  const files = new Map([["input.png", bytes], ["out.png", bytes]]);
  const filesystem = new MemoryFileSystem();
  for (const [name, data] of files) await filesystem.writeFile("/" + name, data);
  for (const font of ["/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Supplemental/Times New Roman.ttf", "DejaVu-Sans"]) {
    const args = ["-label", "WIDE", "-pointsize", "18", "-tile", "1x1", "-geometry", "100x40+4+4", "-font", font, "input.png", "out.png"];
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : mode === "magick" ? await runMagickCli(["montage", ...args], files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unsupported font");
    expect(result.stderr).toContain(font);
    expect(result.stdout).toBe("");
    expect(result.stdoutBytes).toBeUndefined();
    expect(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")).toEqual(bytes);
  }
});
