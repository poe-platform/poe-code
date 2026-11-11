import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI keeps unmatched destination frames.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each([
    { destinations: ["red", "blue", "black"], sources: ["lime", "yellow"], expected: "00ff00ffff00000000" },
    { destinations: ["red", "blue"], sources: ["lime", "yellow", "black"], expected: "00ff00ffff00" },
    { destinations: ["red", "blue", "black"], sources: ["lime"], expected: "00ff0000ff0000ff00" },
    { destinations: ["red"], sources: ["lime", "yellow", "black"], expected: "00ff00ffff00000000" },
  ])(`${mode}: composites $destinations with $sources`, async ({ destinations, sources, expected }) => {
    const argv = [...destinations.map(color => `xc:${color}`), "null:", ...sources.map(color => `xc:${color}`),
      "-layers", "Composite", "-depth", "8", "rgb:-"];
    const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
      : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = "stdoutBytes" in result ? result.stdoutBytes! : Buffer.concat(stdout);
    expect(Buffer.from(output).toString("hex")).toBe(expected);
  });
}
