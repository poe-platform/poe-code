import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

for (const mode of ["command", "sync"] as const) {
 for (const beforeInput of [false, true]) {
  it.each([
    { options: ["-virtual-pixel", "mirror"], expected: "mirror" },
    { options: ["-virtual-pixel", "mirror", "-virtual-pixel", "tile"], expected: "tile" },
    { options: ["-virtual-pixel", "mirror", "-virtual-pixel", "tile", "+virtual-pixel"], expected: "" },
    { options: [], expected: "" }
  ])(`${mode} formats virtual-pixel with $options (before input=${beforeInput})`, async ({ options, expected }) => {
    const args = [...(beforeInput ? [...options, "xc:#2060b080"] : ["xc:#2060b080", ...options]), "-format", "a:%[virtual-pixel]:b", "info:/out"];
    const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", files.get("/out")!);
    let result;
    if (mode === "sync") result = runMagickCliSync(args, files);
    else {
      const argumentValues = createCommandArguments(args);
      let stdout = "", stderr = "";
      const status = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      result = { ...status, stdout, stderr };
    }
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: expected ? "" : "magick: unknown image property '%[virtual-pixel]'\n" });
    expect(new TextDecoder().decode(mode === "sync" ? files.get("/out") : await fs.readFile("/out"))).toBe(`a:${expected}:b`);
  });
}
}
