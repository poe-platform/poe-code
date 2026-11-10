import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "command"] as const) {
  it.each([
    { transform: [], current: "3x2" },
    { transform: ["-transpose"], current: "2x3" },
    { transform: ["-transverse"], current: "2x3" },
    { transform: ["-crop", "1x1+0+0"], current: "1x1" },
    { transform: ["-resize", "1x1!"], current: "1x1" },
  ])(`${mode} preserves original geometry after $transform`, async ({ transform, current }) => {
    const args = ["-size", "3x2", "xc:#80402060", ...transform, "-format", "%G|%wx%h", "info:/out"];
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
    const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
    let result;
    if (mode === "sync") result = runMagickCliSync(args, files);
    else {
      let stdout = "", stderr = "";
      const argumentValues = createCommandArguments(args);
      const status = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
      });
      result = { ...status, stdout, stderr };
    }
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(new TextDecoder().decode(mode === "sync" ? files.get("/out") : await fs.readFile("/out")))
      .toBe(`3x2|${current}`);
  });
}
