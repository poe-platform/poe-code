import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
  it.each([
    {
      name: "uses the active density when reading every saved frame",
      inputs: ["-density", "72", "xc:red", "-density", "120", "xc:blue", "-write", "mpr:seq", "-delete", "0-1", "-density", "144", "mpr:seq"],
      expected: "144/144;144/144;",
    },
    {
      name: "keeps the density when no new setting follows the write",
      inputs: ["-density", "72", "xc:red", "-density", "120", "xc:blue", "-write", "mpr:seq", "-delete", "0-1", "mpr:seq"],
      expected: "120/120;120/120;",
    },
    {
      name: "updates the existing list without an MPR round trip",
      inputs: ["-density", "72", "xc:red", "-density", "120", "xc:blue"],
      expected: "120/120;120/120;",
    },
    {
      name: "applies separate axes to selected saved frames",
      inputs: ["-density", "120", "xc:red", "xc:blue", "-write", "mpr:seq", "-delete", "0-1", "-density", "144x96", "mpr:seq[1,0,1]"],
      expected: "144/96;144/96;144/96;",
    },
    {
      name: "preserves saved density without an active density setting",
      inputs: ["xc:red", "-set", "density", "120x96", "-write", "mpr:seq", "+delete", "mpr:seq"],
      expected: "120/96;",
    },
  ])(`$name (${mode})`, async ({ inputs, expected }) => {
    const fs = new MemoryFileSystem();
    const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
    await fs.writeFile("/out", files.get("/out")!);
    const args = [...inputs, "-format", "%x/%y;", "info:/out"];
    let stderr = "";
    const result = mode === "command"
      ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} },
        stderr: { write: async chunk => { stderr += chunk; } },
      })
      : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(new TextDecoder().decode(output)).toBe(expected);
  });
}
