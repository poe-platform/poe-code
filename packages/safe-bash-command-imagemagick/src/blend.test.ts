import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompositeCli, runMagickCli } from "./index.js";

const cases = [
  { sourceAlpha: 128, destinationAlpha: 102, amount: "50", expected: [125, 55, 125, 115] },
  { sourceAlpha: 128, destinationAlpha: 102, amount: "25x75", expected: [80, 76, 170, 109] },
  { sourceAlpha: 255, destinationAlpha: 255, amount: "50", expected: [115, 60, 135, 255] },
  { sourceAlpha: 255, destinationAlpha: 255, amount: "100x100", expected: [230, 120, 255, 255] },
  { sourceAlpha: 255, destinationAlpha: 255, amount: "80x80", expected: [184, 96, 216, 255] },
  { sourceAlpha: 128, destinationAlpha: 128, amount: "50", expected: [115, 60, 135, 128] },
  { sourceAlpha: 0, destinationAlpha: 102, amount: "50", expected: [30, 100, 220, 51] },
  { sourceAlpha: 128, destinationAlpha: 0, amount: "50", expected: [200, 20, 50, 64] },
  { sourceAlpha: 0, destinationAlpha: 0, amount: "50", expected: [0, 0, 0, 0] },
];

for (const retained of [false, true]) {
  for (const entry of ["blend", "compose", "magick"] as const) {
    it.each(cases)(`Blend ${entry} retained=${retained} alpha=$sourceAlpha/$destinationAlpha amount=$amount matches native`, async ({ sourceAlpha, destinationAlpha, amount, expected }) => {
      const files = new Map<string, Uint8Array>();
      const fs = new MemoryFileSystem();
      for (const [path, pixels] of [
        ["/overlay.png", [200, 20, 50, sourceAlpha]],
        ["/base.png", [30, 100, 220, destinationAlpha]],
      ] as const) {
        const bytes = await sharp(new Uint8Array(pixels), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        files.set(path, bytes);
        await fs.writeFile(path, bytes);
      }
      const input = retained ? { filesystem: fs, cwd: "/" } : files;
      const settings = ["-compose", "Blend", "-define", `compose:args=${amount}`];
      const result = entry === "magick"
        ? await runMagickCli(["/base.png", "/overlay.png", ...settings, "-composite", "/out.png"], input)
        : await runCompositeCli([...(entry === "blend" ? ["-blend", amount] : settings), "/overlay.png", "/base.png", "/out.png"], input);
      expect(result.exitCode).toBe(0);
      expect([...decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!).data]).toEqual(expected);
    });
  }
}

const native = spawnSync("magick", ["-version"]);
it.skipIf(native.error !== undefined)("verifies Blend references against native ImageMagick", async () => {
  for (const { sourceAlpha, destinationAlpha, amount, expected } of cases) {
    const inputs = await Promise.all([[200, 20, 50, sourceAlpha], [30, 100, 220, destinationAlpha]].map(async pixels => {
      const bytes = await sharp(new Uint8Array(pixels), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
      return `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
    }));
    const result = spawnSync("magick", ["composite", "-blend", amount, ...inputs, "png:-"]);
    expect(result.status).toBe(0);
    expect([...decodeImage(result.stdout).data]).toEqual(expected);
  }
});
