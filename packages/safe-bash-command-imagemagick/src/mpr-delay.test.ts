import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["map", "sync", "filesystem", "command"] as const) {
  it.each([
    { operations: ["-write", "mpr:seq", "-delete", "0-1", "mpr:seq"], expected: "12;12;" },
    { operations: ["-write", "mpr:seq", "-delete", "0-1", "-delay", "19", "mpr:seq"], expected: "19;19;" },
    { operations: ["-write", "mpr:seq", "-delete", "0-1", "+delay", "mpr:seq"], expected: "0;0;" },
    { operations: [], expected: "7;12;" },
    { operations: ["-write", "mpr:seq", "-delay", "19", "mpr:seq", "+delay", "mpr:seq"], expected: "7;12;19;19;0;0;" },
  ])(`applies the active delay only to MPR reads (${mode}): $operations`, async ({ operations, expected }) => {
    const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", files.get("/out")!);
    const argv = ["-delay", "7", "xc:red", "-delay", "12", "xc:blue", ...operations, "-format", "%T;", "info:/out"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
      : await runMagickCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    const output = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(new TextDecoder().decode(output)).toBe(expected);
  });
}
