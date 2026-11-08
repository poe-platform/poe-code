import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompositeCli, runConvertCli, runConvertCliSync } from "./index.js";

const native = spawnSync("magick", ["-version"]);

for (const route of ["buffered", "retained", "sync", "composite"] as const)
for (const destinationAlpha of [false, true])
for (const sourceAlpha of [false, true]) {
  it(`Intensity ${route} destination alpha=${destinationAlpha}, source alpha=${sourceAlpha}`, async () => {
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    const destination = [[20, 80, 180, 255], [150, 70, 40, 127], [40, 160, 80, 255], [90, 30, 60, 0]];
    const source = [[20, 80, 180, 255], [151, 70, 40, 127], [200, 50, 10, 64], [200, 50, 10, 0]];
    for (const [path, pixels, alpha] of [["/dst.png", destination, destinationAlpha], ["/src.png", source, sourceAlpha]] as const) {
      const channels = alpha ? 4 : 3;
      const bytes = await sharp(new Uint8Array(pixels.flatMap(pixel => pixel.slice(0, channels))), {
        raw: { width: 4, height: 1, channels },
      }).png().toBuffer();
      files.set(path, bytes);
      await fs.writeFile(path, bytes);
    }
    const args = ["/dst.png", "/src.png", "-compose", "Intensity", "-composite", "/out.png"];
    const result = route === "sync" ? runConvertCliSync(args, files)
      : route === "composite" ? await runCompositeCli(["-compose", "Intensity", "/src.png", "/dst.png", "/out.png"], { filesystem: fs, cwd: "/" })
      : await runConvertCli(args, route === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(route === "retained" || route === "composite" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    const alphas = [74, 85, 79, 79];
    expect([...output.data]).toEqual(destination.flatMap((pixel, i) => [...pixel.slice(0, 3), destinationAlpha ? alphas[i]! : 255]));
    expect(output.hasAlpha).toBe(destinationAlpha);
    if (!native.error) {
      const inputs = ["/dst.png", "/src.png"].map(path => `inline:data:image/png;base64,${Buffer.from(files.get(path)!).toString("base64")}`);
      const reference = spawnSync("magick", [...inputs, "-compose", "Intensity", "-composite", "png:-"]);
      expect(reference.status, reference.stderr.toString()).toBe(0);
      expect([...output.data]).toEqual([...decodeImage(reference.stdout).data]);
    }
  });
}
