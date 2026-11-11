import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {runConvertCli, runMagickCliSync} from "./index.js";

const input = Buffer.from("50360a3220310a3235350aff00000000ff", "hex");

for (const depth of [4, 8, 10, 16]) for (const format of ["pgm", "ppm"]) {
  it.each(["buffered", "retained", "sync"] as const)(`writes native plain ${format} samples at depth ${depth} through %s conversion`, async execution => {
    const files = new Map<string, Uint8Array>([["in.pnm", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.pnm", input);
    const args = ["in.pnm", "-depth", String(depth), "-compress", "None", `out.${format}`];
    const result = execution === "sync" ? runMagickCliSync(args, files)
      : await runConvertCli(args, execution === "retained" ? {filesystem, cwd: "/"} : files);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const output = execution === "retained" ? await filesystem.readFile(`/out.${format}`) : files.get(`out.${format}`)!;
    // ImageMagick 7 Q16-HDRI: plain P2/P3 use byte or short ranges.
    const maximum = depth <= 8 ? 255 : 65535;
    const samples = format === "ppm" ? [maximum, 0, 0, 0, 0, maximum] : depth <= 8 ? [54, 18] : [13936, 4731];
    expect(Buffer.from(output).toString().trim().split("\n").flatMap(line => line.split(" ")).filter(Boolean)).toEqual([
      format === "ppm" ? "P3" : "P2", "2", "1", String(maximum), ...samples.map(String)
    ]);
  });
}
