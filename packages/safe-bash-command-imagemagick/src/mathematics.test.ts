import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompositeCli, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2: magick -size 1x1 xc:DEST xc:SOURCE
// -define compose:args=COEFFICIENTS -compose Mathematics -composite -depth 8 rgba:-
const coefficients = ["0,0.25,0.75,0", "0,1,0,0", "1,0,0,0", "0,0,0,0.2", "0,-1,1,0", "0,2", undefined];
const samples = [
  { dst: "#28a050", src: "#c8320a", pixels: [[80,133,63,255], [200,50,10,255], [31,31,3,255], [51,51,51,255], [0,110,70,255], [255,100,20,255], [0,0,0,255]] },
  { dst: "#9646287f", src: "#9746287f", pixels: [[150,70,40,191], [151,70,40,191], [130,53,29,191], [118,64,44,191], [100,47,27,191], [201,93,53,191], [101,47,27,191]] },
  { dst: "#28a050ff", src: "#c8320a40", pixels: [[50,153,76,255], [80,132,62,255], [38,128,61,255], [43,133,73,255], [0,147,77,255], [130,145,65,255], [30,120,60,255]] },
  { dst: "#5a1e3c00", src: "#0a502800", pixels: coefficients.map(() => [0,0,0,0]) },
];

for (const route of ["buffered", "retained", "sync", "composite"] as const)
for (const before of [false, true])
for (const sample of samples) {
  it.each(coefficients)(`Mathematics ${route}, settings before inputs=${before}, ${sample.dst}, coefficients=%s`, async value => {
    const files = new Map<string, Uint8Array>();
    const filesystem = new MemoryFileSystem();
    const settings = [...(value === undefined ? [] : ["-define", `compose:args=${value}`]), "-compose", "Mathematics"];
    const inputs = route === "composite" ? [`xc:${sample.src}`, `xc:${sample.dst}`] : [`xc:${sample.dst}`, `xc:${sample.src}`];
    const args = [...(before ? [...settings, ...inputs] : [...inputs, ...settings]), ...(route === "composite" ? [] : ["-composite"]), "out.png"];
    const result = route === "sync" ? runConvertCliSync(args, files)
      : route === "composite" ? await runCompositeCli(args, { filesystem, cwd: "/" })
      : await runConvertCli(args, route === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = route === "retained" || route === "composite" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
    expect([...decodeImage(output).data]).toEqual(sample.pixels[coefficients.indexOf(value)]);
  });
}
