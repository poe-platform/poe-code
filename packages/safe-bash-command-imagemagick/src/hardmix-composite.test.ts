import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompositeCli, runConvertCli, runConvertCliSync } from "./index.js";

for (const route of ["buffered", "retained", "sync", "composite"] as const)
for (const alpha of [false, true]) {
  it(`HardMix blends color and alpha through ${route}, alpha=${alpha}`, async () => {
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    const destination = [[20, 80, 180, 255], [150, 70, 40, 127], [40, 160, 80, 255], [150, 70, 40, 255], [10, 20, 30, 255], [10, 20, 30, 0]];
    const source = [[20, 80, 180, 255], [151, 70, 40, 127], [200, 50, 10, 64], [105, 185, 215, 255], [100, 110, 120, 0], [100, 110, 120, 255]];
    for (const [path, pixels] of [["/dst.png", destination], ["/src.png", source]] as const) {
      const channels = alpha ? 4 : 3;
      const bytes = await sharp(new Uint8Array(pixels.flatMap(pixel => pixel.slice(0, channels))), {
        raw: { width: 6, height: 1, channels },
      }).png().toBuffer();
      files.set(path, bytes);
      await fs.writeFile(path, bytes);
    }
    const args = ["/dst.png", "/src.png", "-compose", "HardMix", "-composite", "/out.png"];
    const result = route === "sync" ? runConvertCliSync(args, files)
      : route === "composite" ? await runCompositeCli(["-compose", "HardMix", "/src.png", "/dst.png", "/out.png"], { filesystem: fs, cwd: "/" })
      : await runConvertCli(args, route === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(route === "retained" || route === "composite" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    // ImageMagick 7 reference pixels, including the inclusive sum=255 threshold.
    expect([...output.data]).toEqual((alpha
      ? [[0, 0, 255, 255], [185, 47, 27, 191], [30, 120, 60, 255], [255, 255, 255, 255], [10, 20, 30, 255], [100, 110, 120, 255]]
      : [[0, 0, 255, 255], [255, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 0, 255], [0, 0, 0, 255]]).flat());
  });
}
