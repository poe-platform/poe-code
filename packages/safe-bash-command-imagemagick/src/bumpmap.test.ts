import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompositeCli, runCompositeCliSync, runConvertCli, runConvertCliSync } from "./index.js";

const cases = [
  { source: [128, 128, 128, 255], alpha: 255, expected: [50, 75, 100, 128] },
  { source: [0, 0, 0, 255], alpha: 255, expected: [0, 0, 0, 0] },
  { source: [255, 255, 255, 255], alpha: 255, expected: [100, 150, 200, 255] },
  { source: [255, 0, 0, 255], alpha: 102, expected: [21, 32, 43, 22] },
  { source: [128, 128, 128, 128], alpha: 102, expected: [50, 75, 100, 51] },
  { source: [128, 128, 128, 0], alpha: 102, expected: [100, 150, 200, 51] },
];

for (const mode of ["sync", "buffered", "retained"] as const) {
  for (const composite of [false, true]) {
    it.each(cases)(`Bumpmap ${mode} composite=${composite} source=$source alpha=$alpha`, async ({ source, alpha, expected }) => {
      const files = new Map<string, Uint8Array>();
      const filesystem = new MemoryFileSystem();
      for (const [path, pixels] of [["/overlay.png", source], ["/base.png", [100, 150, 200, alpha]]] as const) {
        const bytes = await sharp(new Uint8Array(pixels), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        files.set(path, bytes);
        await filesystem.writeFile(path, bytes);
      }
      const args = composite
        ? ["-compose", "Bumpmap", "/overlay.png", "/base.png", "/out.png"]
        : ["/base.png", "/overlay.png", "-compose", "Bumpmap", "-composite", "/out.png"];
      const input = mode === "retained" ? { filesystem, cwd: "/" } : files;
      const result = mode === "sync"
        ? (composite ? runCompositeCliSync : runConvertCliSync)(args, files)
        : await (composite ? runCompositeCli : runConvertCli)(args, input);
      expect(result.exitCode).toBe(0);
      expect([...decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!).data]).toEqual(expected);
    });
  }
}

it.skipIf(spawnSync("magick", ["-version"]).status !== 0)("checks Bumpmap references against native ImageMagick using identical PNG inputs", async () => {
  for (const { source, alpha, expected } of cases) {
    const inputs = await Promise.all([source, [100, 150, 200, alpha]].map(async pixels => {
      const bytes = await sharp(new Uint8Array(pixels), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
      return `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
    }));
    const native = spawnSync("magick", ["composite", "-compose", "Bumpmap", ...inputs, "png:-"]);
    expect(native.status).toBe(0);
    expect([...decodeImage(native.stdout).data]).toEqual(expected);
  }
});
