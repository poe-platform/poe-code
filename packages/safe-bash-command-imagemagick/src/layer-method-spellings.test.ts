import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const frames = [
  "(", "-size", "2x1", "xc:#80402080", "-repage", "4x3+1+0", ")",
  "(", "-size", "1x2", "xc:#204080c0", "-repage", "4x3+2+1", ")",
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each([
    { method: "remove-dups", input: ["xc:red"], output: "0:1x1:1x1+0+0;" },
    { method: "trim-bounds", input: frames, output: "0:2x1:2x3+0+0;1:1x2:2x3+1+1;" },
    { method: "trim_bounds", input: frames, output: "0:2x1:2x3+0+0;1:1x2:2x3+1+1;" },
    { method: "compare-any", input: frames, output: "0:2x1:4x3+1+0;1:1x2:4x3+2+1;" },
    { method: "optimize-frame", input: ["xc:red"], output: "0:1x1:1x1+0+0;" },
  ])(`${mode} accepts native $method spelling`, async ({ method, input, output }) => {
    const args = [...input, "-layers", method, "-format", "%s:%wx%h:%g;", "info:-"];
    const filesystem = new MemoryFileSystem();
    let stdout = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async chunk => { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
      stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, new Map())
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : new Map());
    expect(result.exitCode).toBe(0);
    expect("stdout" in result ? result.stdout : stdout).toBe(output);
  });
}
