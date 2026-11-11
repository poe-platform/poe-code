import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
  const cases = [
    ...["label", "comment", "artifact:demo", "delay"].flatMap(key => [false, true].map(quiet => ({
      name: `${key}, quiet=${quiet}`,
      args: [...(quiet ? ["-quiet"] : []), "-set", key, "hello", "xc:red", "-depth", "8", "rgb:-"],
      stderr: quiet ? "" : `magick: no image to apply a property '-set' '${key}' at CLI arg 1\n`,
      bytes: [255, 0, 0],
    }))),
    { name: "emptied stack", args: ["xc:blue", "+delete", "-set", "label", "hello", "xc:red", "-depth", "8", "rgb:-"], stderr: "magick: no image to apply a property '-set' 'label' at CLI arg 3\n", bytes: [255, 0, 0] },
    { name: "loaded label", args: ["xc:red", "-set", "label", "hello", "-format", "%[label]", "info:"], stderr: "", bytes: [...new TextEncoder().encode("hello")] },
    { name: "pre-input option", args: ["-set", "option:demo", "hello", "xc:red", "-format", "%[option:demo]", "info:"], stderr: "", bytes: [...new TextEncoder().encode("hello")] },
    { name: "discarded label", args: ["-set", "label", "hello", "xc:red", "-quiet", "-format", "%[label]", "info:"], stderr: "magick: no image to apply a property '-set' 'label' at CLI arg 1\n", bytes: [] },
  ];
  for (const test of cases) {
    it(`${test.name} through ${mode}`, async () => {
      const fs = new MemoryFileSystem();
      if (mode === "command") {
        const bytes: number[] = [];
        let stderr = "";
        const result = await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(test.args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async chunk => { bytes.push(...chunk); } },
          stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
        });
        expect(result.exitCode).toBe(0);
        expect(stderr).toBe(test.stderr);
        expect(bytes).toEqual(test.bytes);
      } else {
        const result = await runConvertCli(test.args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe(test.stderr);
        expect([...(result.stdoutBytes ?? new TextEncoder().encode(result.stdout))]).toEqual(test.bytes);
      }
    });
  }
}
