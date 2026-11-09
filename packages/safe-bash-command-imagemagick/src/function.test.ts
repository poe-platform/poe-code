import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick: RGBA [100,150,200,160], -function Polynomial 0.5,0.2.
for (const mode of ["buffered", "retained", "sync"] as const) {
  it.each([
    [[], [101, 126, 151, 131]],
    [["-channel", "Default"], [101, 126, 151, 131]],
    [["-channel", "All"], [101, 126, 151, 131]],
    [["-channel", "RGB"], [101, 126, 151, 160]],
    [["-channel", "RGBA"], [101, 126, 151, 131]],
    [["-channel", "RGB", "+channel"], [101, 126, 151, 131]],
    [["-channel", "A"], [100, 150, 200, 131]],
    [["-alpha", "off"], [101, 126, 151, 255]],
    [["-alpha", "off", "-channel", "Default"], [101, 126, 151, 255]],
  ] as const)(`${mode}: function matches native channel selection %j`, async (channel, expected) => {
    const bytes = await sharp(new Uint8Array([100, 150, 200, 160]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["/in.png", bytes]]);
    const filesystem = createMemoryFileSystem();
    await filesystem.writeFile("/in.png", bytes);
    const args = ["/in.png", ...channel, "-function", "Polynomial", "0.5,0.2", "/out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect([...output.data]).toEqual(expected);
  });
}
