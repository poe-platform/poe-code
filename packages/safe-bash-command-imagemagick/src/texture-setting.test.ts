import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each([
    ["xc:red", "xc:lime"],
    ["xc:red", "xc:lime", "-texture", "xc:blue"],
    ["xc:red", "xc:lime", "-texture", "in.ppm"],
    ["xc:red", "xc:lime", "-texture", "missing.ppm"],
    ["xc:red", "xc:lime", "+texture"],
    ["-texture", "xc:blue", "xc:red", "+texture", "xc:lime"],
    ["xc:red", "(", "-texture", "in.ppm", "xc:lime", "+texture", ")"]
  ])(`accepts texture settings without adding or changing pixels (${mode}): %j`, async (...inputs) => {
    const argv = [...inputs, "+append", "-depth", "8", "rgb:-"];
    const texture = Uint8Array.from([...new TextEncoder().encode("P6\n1 1\n255\n"), 1, 2, 3]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", texture);
    const files = new Map([["in.ppm", texture]]);
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const argumentValues = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
      : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const output = mode === "command" ? Buffer.concat(chunks)
      : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
    expect(output.toString("hex")).toBe("ff000000ff00");
  });
}
