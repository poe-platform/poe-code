import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: complete Intensity tiles preserve opaque RGB;
// tiles crossing the canvas boundary copy source RGB instead.
for (const route of ["command", "buffered", "retained", "sync"] as const)
for (const { width, height, sourceHeight, alpha, tiled, expected } of [
  ...[3, 4, 5, 6].flatMap(width => [false, true].map(tiled => ({
    width, height: 1, sourceHeight: 1, alpha: false, tiled,
    expected: tiled && width % 2 === 1 ? "a06e3cff".repeat(width - 1) + "0a141eff" : "a06e3cff".repeat(width),
  }))),
  { width: 4, height: 3, sourceHeight: 2, alpha: false, tiled: true, expected: "a06e3cff".repeat(8) + "0a141eff5a6e82ff".repeat(2) },
  { width: 3, height: 3, sourceHeight: 2, alpha: false, tiled: true, expected: "a06e3cffa06e3cff0a141effa06e3cffa06e3cff28323cff0a141eff5a6e82ff0a141eff" },
  { width: 3, height: 1, sourceHeight: 1, alpha: true, tiled: true, expected: "a06e3c13a06e3c6b0a141eff" },
]) {
  it(`Intensity ${route}: ${width}x${height}, tile=${tiled}, alpha=${alpha}`, async () => {
    const source = alpha ? [10, 20, 30, 128, 90, 110, 130, 64]
      : [10, 20, 30, 90, 110, 130, 40, 50, 60, 70, 80, 90].slice(0, 6 * sourceHeight);
    const header = (w: number, h: number) => Buffer.from(alpha
      ? `P7\nWIDTH ${w}\nHEIGHT ${h}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`
      : `P6\n${w} ${h}\n255\n`);
    const files = new Map([
      ["/in.ppm", Buffer.concat([header(2, sourceHeight), Buffer.from(source)])],
      ["/base.ppm", Buffer.concat([header(width, height), Buffer.from(Array.from({ length: width * height }, () => alpha ? [160, 110, 60, 128] : [160, 110, 60]).flat())])],
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const argv = ["composite", ...(tiled ? ["-tile"] : []), "-compose", "Intensity", "/in.ppm", "/base.ppm", "-depth", "8", "rgba:-"];
    const args = createCommandArguments(argv);
    let stdout = "";
    const result = route === "command" ? await createMagickCommand().execute({
      command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
      stderr: { async write() {} },
    }) : route === "sync" ? runMagickCliSync(argv, files)
      : await runMagickCli(argv, route === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const hex = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
      ? Buffer.from(result.stdoutBytes).toString("hex") : stdout;
    expect(hex).toBe(expected);
  });
}
