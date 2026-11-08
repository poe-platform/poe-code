import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const route of ["sync", "buffered", "retained"] as const) {
  it(`${route}: consumes the third composite image as a black/gray/white mask`, async () => {
    const png = (pixels: number[]) => encodeImage({
      width: 3, height: 1, data: Uint8Array.from(pixels), hasAlpha: false,
      channels: 3, format: "png", space: "srgb", depth: "uchar", density: 72,
    }, { format: "png" }).data;
    const files = new Map([
      ["/dst.png", png([20, 80, 180, 255, 150, 70, 40, 255, 40, 160, 80, 255])],
      ["/src.png", png([250, 10, 30, 255, 10, 250, 30, 255, 10, 30, 250, 255])],
      ["/mask.png", png([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255])],
    ]);
    const filesystem = createMemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
    const args = ["/dst.png", "/src.png", "/mask.png", "-compose", "Over", "-composite", "/out.png"];
    const result = route === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, route === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const output = route === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
    expect([...decodeImage(output).data]).toEqual([20, 80, 180, 255, 80, 160, 35, 255, 10, 30, 250, 255]);
    for (const path of ["/out-0.png", "/out-1.png"]) {
      if (route === "retained") await expect(filesystem.readFile(path)).rejects.toThrow();
      else expect(files.has(path)).toBe(false);
    }
  });
}
