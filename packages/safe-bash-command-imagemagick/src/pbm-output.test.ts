import {spawnSync} from "node:child_process";
import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {createCommandArguments} from "safe-bash-contracts/command";
import {createMagickCommand, runConvertCli, runConvertCliSync} from "./index.js";

for (const fixture of [
  {depth: "16", format: "rgb", hex: "1234456789abcdef13792468", pixels: [255, 0], bits: 0x40},
  {depth: "8", format: "rgba", hex: "12345680abcdef40", pixels: [0, 255], bits: 0x80},
  {depth: "8", format: "rgb", hex: "123456123456", pixels: [0, 0], bits: 0xc0},
])
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each([[], ["+dither"], ["-compress", "None"], ["-write", "/copy.pbm"]].map(options => ({options})))(`matches native PBM pixel decisions via ${mode} (${fixture.hex}): %j`, async ({options}) => {
    const png = spawnSync("magick", ["-size", "2x1", "-depth", fixture.depth, "-endian", "MSB", `${fixture.format}:-`, "PNG48:-"], {input: Buffer.from(fixture.hex, "hex")});
    expect(png.status).toBe(0);
    const files = new Map<string, Uint8Array>([["/in.png", png.stdout]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", png.stdout);
    const args = ["/in.png", ...options, "/out.pbm"];
    const commandArgs = createCommandArguments(args);
    const result = mode === "command" ? await createMagickCommand().execute({command: "magick", args: commandArgs.args, argumentValues: commandArgs, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: {async write() {}}, stderr: {async write() {}}}) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? {filesystem, cwd: "/"} : files);
    expect(result).toMatchObject({exitCode: 0});
    for (const path of options.includes("-write") ? ["/copy.pbm", "/out.pbm"] : ["/out.pbm"]) {
      const output = mode === "retained" || mode === "command" ? await filesystem.readFile(path) : files.get(path)!;
      const decoded = spawnSync("magick", ["pbm:-", "-depth", "8", "gray:-"], {input: output});
      expect(decoded.status).toBe(0);
      expect([...decoded.stdout]).toEqual(fixture.pixels);
      if (!options.includes("None")) expect(output[output.length - 1]! & 0xc0).toBe(fixture.bits);
    }
  });
}
