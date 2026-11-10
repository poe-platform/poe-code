import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7: later frames compare against the optimized canvas.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([
    [["#1a3b5280", "#1a3b5280", "#1a3b5280"], "1a3b52801a3b52001a3b5200"],
    [["#1a3b5280", "#1a3b5280", "#1a3b52c0"], "1a3b52801a3b52001a3b52c0"],
    [["#1a3b5280", "#1a3b5280"], "1a3b52801a3b5200"],
    [["#1a3b52", "#1a3b52", "#1a3b52"], "1a3b52ff1a3b52001a3b5200"],
  ] as const)(`${mode} retains optimized canvas for %j`, async (colors, expected) => {
    const files = new Map<string, Uint8Array>();
    const filesystem = new MemoryFileSystem();
    const chunks: Uint8Array[] = [];
    const args = [...colors.map(color => `xc:${color}`), "-layers", "OptimizeTransparency", "-depth", "8", "rgba:-"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async chunk => { chunks.push(chunk); } }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes) : Buffer.concat(chunks);
    expect(output.toString("hex")).toBe(expected);
  });
}
