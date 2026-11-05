import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompositeCli, runCompositeCliSync, runMagickCli } from "./index.js";

const cases = [
  { sourceAlpha: 128, destinationAlpha: 102, amount: "50", expected: [0, 33, 153, 102] },
  { sourceAlpha: 128, destinationAlpha: 102, amount: "25x75", expected: [12, 65, 155, 102] },
  { sourceAlpha: 255, destinationAlpha: 255, amount: "50", expected: [0, 33, 153, 255] },
  { sourceAlpha: 0, destinationAlpha: 102, amount: "50", expected: [30, 100, 220, 102] },
  { sourceAlpha: 128, destinationAlpha: 0, amount: "50", expected: [0, 33, 153, 0] },
  { sourceAlpha: 128, destinationAlpha: 102, amount: "0x100", expected: [30, 100, 220, 102] },
];

for (const retained of [false, true]) {
  for (const entry of ["watermark", "compose", "magick", ...(retained ? [] : ["sync"])] as const) {
    it.each(cases)(`Modulate ${entry} retained=${retained} alpha=$sourceAlpha/$destinationAlpha amount=$amount matches native`, async ({ sourceAlpha, destinationAlpha, amount, expected }) => {
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
      const settings = ["-compose", "Modulate", "-define", `compose:args=${amount}`];
      const result = entry === "sync"
        ? runCompositeCliSync(["-watermark", amount, "/overlay.png", "/base.png", "/out.png"], files)
        : entry === "magick"
        ? await runMagickCli(["/base.png", "/overlay.png", ...settings, "-composite", "/out.png"], input)
        : await runCompositeCli([...(entry === "watermark" ? ["-watermark", amount] : settings), "/overlay.png", "/base.png", "/out.png"], input);
      expect(result.exitCode).toBe(0);
      expect([...decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!).data]).toEqual(expected);
    });
  }
}

const native = spawnSync("magick", ["-version"]);
it.skipIf(native.error !== undefined)("verifies Modulate references against native ImageMagick", async () => {
  for (const { sourceAlpha, destinationAlpha, amount, expected } of cases) {
    const inputs = await Promise.all([[200, 20, 50, sourceAlpha], [30, 100, 220, destinationAlpha]].map(async pixels => {
      const bytes = await sharp(new Uint8Array(pixels), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
      return `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
    }));
    const result = spawnSync("magick", ["composite", "-watermark", amount, ...inputs, "png:-"]);
    expect(result.status).toBe(0);
    expect([...decodeImage(result.stdout).data]).toEqual(expected);
  }
});
