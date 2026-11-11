import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["map", "retained", "sync", "command"] as const) {
  it.each([
    ["abc", undefined],
    ["%[fx:3]", undefined],
    ["3x1", "135ca5ffc93780ffc9375bffa4c836ff7fc811ff5aa3ecff357ec7ff3559a2ffc6347dffc60f58ffa1ea33ff7cc533ff57a0c4ff327bc4ff0d569fff"],
    ["1x3", "135ca5ffee3780ffc9125bffa4ed36ff7fc811ff5aa3a5ff7c7e80ff5759a2ffa47b7dff7f5658ffa1ea33ff7cc50eff57a0e9ff327bc4ff0d569fff"],
  ])(`${mode}: validates median geometry %s against native ImageMagick`, async (geometry, expected) => {
    const bytes = new Uint8Array([...new TextEncoder().encode("P6\n5 3\n255\n"), ...Array.from({ length: 45 }, (_, i) => (i * 73 + 19) % 256)]);
    const files = new Map([["/in.ppm", bytes]]);
    const fs = createMemoryFileSystem();
    await fs.writeFile("/in.ppm", bytes);
    const args = ["-quiet", "/in.ppm", "-median", geometry!, "-depth", "8", "rgba:-"];
    const stdout: number[] = [];
    let stderr = "";
    const result = mode === "command" ? {
      ...await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async bytes => { stdout.push(...bytes); } },
        stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
      }), stderr, stdoutBytes: Uint8Array.from(stdout)
    } : mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(expected === undefined ? 1 : 0);
    expect(Buffer.from(result.stdoutBytes ?? []).toString("hex")).toBe(expected ?? "");
    if (expected === undefined) {
      expect(result.stderr).toContain("invalid argument for option '-statistic'");
      expect(result.stderr).toContain(geometry);
    } else expect(result.stderr).toBe("");
  });
}
