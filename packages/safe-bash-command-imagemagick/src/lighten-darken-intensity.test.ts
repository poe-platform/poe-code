import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompositeCli, runConvertCli, runConvertCliSync } from "./index.js";

const native = spawnSync("magick", ["-version"]);

for (const mode of ["LightenIntensity", "DarkenIntensity"])
for (const route of ["buffered", "retained", "sync", "composite"] as const)
for (const destinationAlpha of [false, true])
for (const sourceAlpha of [false, true]) {
  it(`${mode} ${route} destination alpha=${destinationAlpha}, source alpha=${sourceAlpha}`, async () => {
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    const destination = [[20, 80, 180, 255], [150, 70, 40, 127], [40, 160, 80, 255], [90, 30, 60, 0], [0, 0, 0, 255]];
    const source = [[250, 10, 30, 255], [10, 250, 30, 127], [10, 30, 250, 64], [90, 30, 60, 0], [100, 80, 60, 64]];
    for (const [path, pixels, alpha] of [["/dst.png", destination, destinationAlpha], ["/src.png", source, sourceAlpha]] as const) {
      const channels = alpha ? 4 : 3;
      const bytes = await sharp(new Uint8Array(pixels.flatMap(pixel => pixel.slice(0, channels))), {
        raw: { width: 5, height: 1, channels },
      }).png().toBuffer();
      files.set(path, bytes);
      await fs.writeFile(path, bytes);
    }
    const args = ["/dst.png", "/src.png", "-compose", mode, "-composite", "/out.png"];
    const result = route === "sync" ? runConvertCliSync(args, files)
      : route === "composite" ? await runCompositeCli(["-compose", mode, "/src.png", "/dst.png", "/out.png"], { filesystem: fs, cwd: "/" })
      : await runConvertCli(args, route === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(route === "retained" || route === "composite" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    const colors = mode === "LightenIntensity" ? [destination[0]!, source[1]!, destination[2]!, destination[3]!, source[4]!] : [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], sourceAlpha ? [25, 20, 15] : [100, 80, 60]];
    expect([...output.data]).toEqual(colors.flatMap(pixel => [...pixel.slice(0, 3), destinationAlpha ? 0 : 255]));
    if (!native.error) {
      const inputs = ["/dst.png", "/src.png"].map(path => `inline:data:image/png;base64,${Buffer.from(files.get(path)!).toString("base64")}`);
      const reference = spawnSync("magick", [...inputs, "-compose", mode, "-composite", "-depth", "8", "rgba:-"]);
      expect(reference.status, reference.stderr.toString()).toBe(0);
      expect([...output.data]).toEqual([...reference.stdout]);
    }
  });
}
