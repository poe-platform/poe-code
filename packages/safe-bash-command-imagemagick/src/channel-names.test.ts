import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick: -channel <selection> -function Polynomial 0.8.
// A constant function makes every selected component 204, including alpha.
const selections = [
  ["Red", "r"], ["Green", "g"], ["Blue", "b"], ["Alpha", "a"],
  ["R", "r"], ["G", "g"], ["B", "b"], ["A", "a"],
  ["Cyan", "r"], ["C", "r"], ["Magenta", "g"], ["M", "g"],
  ["Yellow", "b"], ["Y", "b"], ["Gray", "r"],
  ["Hue", "r"], ["Saturation", "g"], ["Lightness", "b"],
  ["Green,Alpha", "ga"], ["All,Alpha", "rgba"], ["Red,Blue", "rb"],
  ["Cyan,Magenta,Yellow", "rgb"], ["  gReEn , ALPHA  ", "ga"],
  ["RGB", "rgb"], ["RGBA", "rgba"], ["RG", "rg"], ["CMY", "rgb"],
  ["Sync,RGBA", "rgba"], ["Green,Sync", "g"], ["All", "rgba"],
] as const;

for (const mode of ["buffered", "retained", "sync"] as const) {
  it.each(selections)(`${mode}: selects complete channel tokens in %s`, async (selection, selected) => {
    const pixels = [11, 22, 33, 88, 55, 66, 77, 99];
    const input = await sharp(Uint8Array.from(pixels), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["/in.png", input]]);
    const filesystem = createMemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    const args = ["/in.png", "-channel", selection, "-function", "Polynomial", "0.8", "/out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
    expect([...decodeImage(output).data]).toEqual(pixels.map((value, index) => selected.includes("rgba"[index % 4]!) ? 204 : value));
  });

  it.each([
    ["Green", [100, 184, 200, 160]],
    ["Gray", [114, 150, 200, 160]],
    ["Cyan", [114, 150, 200, 160]],
    ["Magenta", [100, 184, 200, 160]],
    ["Yellow", [100, 150, 230, 160]],
    ["Green,Alpha", [100, 184, 200, 195]],
  ] as const)(`${mode}: sigmoidal contrast honors %s`, async (selection, expected) => {
    const input = await sharp(Uint8Array.from([100, 150, 200, 160]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["/in.png", input]]);
    const filesystem = createMemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    const args = ["/in.png", "-channel", selection, "-sigmoidal-contrast", "5x40%", "/out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
    expect([...decodeImage(output).data]).toEqual(expected);
  });

  it.each(["Greener", "AlphaRed", "constructor"])(`${mode}: rejects unknown channel token %s without replacing output`, async selection => {
    const original = new Uint8Array([1, 2, 3]);
    const files = new Map([["/out.png", original]]);
    const filesystem = createMemoryFileSystem();
    await filesystem.writeFile("/out.png", original);
    const args = ["-size", "1x1", "xc:red", "-channel", selection, "-function", "Polynomial", "0.8", "/out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("unrecognized channel type");
    expect(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")).toEqual(original);
  });
}
