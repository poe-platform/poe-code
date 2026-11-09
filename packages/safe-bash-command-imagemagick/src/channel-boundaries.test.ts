import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35: each selection is a single argv element.
// Polynomial 0.8 writes 204 to selected channels, preserving every other byte.
const selections = [
  ["R", "r"],
  ["Red Blue", "r"],
  ["R B", "r"],
  ["Red, Blue", "rb"],
  ["Red | Blue", "rb"],
  ["R,B", "rb"],
  ["R|B", "rb"],
  ["  Red  Blue  ", "r"],
  ["Red\tBlue", "r"],
  ["Red\nBlue", "r"],
  ["Red Blue, Green", "rg"],
  ["Red Blue | Green", "rg"],
  ["Red, Blue Alpha", "rb"],
  ["Red | Blue Alpha", "rb"],
] as const;

for (const mode of ["buffered", "retained", "sync"] as const) {
  it.each(selections)(`${mode}: matches native channel boundaries in %j`, async (selection, selected) => {
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
}
