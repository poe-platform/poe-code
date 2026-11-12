import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// RGBA8 output from ImageMagick 7.1.2-35 Q16-HDRI.
for (const execution of ["magick", "montage", "buffered", "retained", "sync"] as const) {
  it.each([
    { background: "none", modes: ["associate"], hex: "6e281080" },
    { background: "none", modes: ["disassociate"], hex: "ff9f40ff" },
    { background: "navy", modes: ["associate", "disassociate"], hex: "dc5020ff" },
    { background: "none", modes: [], hex: "dc502080" },
    { background: "none", modes: ["off"], hex: "dc5020ff" },
  ])(`${execution}: montage alpha $modes over $background`, async ({ background, modes, hex }) => {
    const argv = ["-geometry", "1x1+0+0", "-tile", "x1", "-background", background,
      "xc:#dc502080", ...modes.flatMap(mode => ["-alpha", mode]), "-depth", "8", "rgba:-"];
    const fs = new MemoryFileSystem();
    let output: Uint8Array;
    if (execution === "magick" || execution === "montage") {
      const argumentValues = createCommandArguments(execution === "magick" ? ["montage", ...argv] : argv);
      const chunks: Uint8Array[] = [], stderr: unknown[] = [];
      const result = await (execution === "magick" ? createMagickCommand() : createMontageCommand()).execute({
        command: execution, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk); } },
        stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
      });
      expect(stderr).toEqual([]);
      expect(result.exitCode).toBe(0);
      output = Buffer.concat(chunks);
    } else {
      const files = new Map<string, Uint8Array>();
      const result = execution === "sync" ? runMontageCliSync(argv, files)
        : await runMontageCli(argv, execution === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    expect(Buffer.from(output).toString("hex")).toBe(hex);
  });
}
