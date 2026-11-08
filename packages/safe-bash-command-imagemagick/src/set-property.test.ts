import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const extension of ["png", "jpg", "gif", "tiff"]) {
  for (const mode of ["buffered", "retained", "command"]) {
    for (const operation of [[], ["-flop"], ["-strip"]]) {
      it(`writes expanded properties to ${extension} through ${mode} after ${operation.join(" ")}`, async () => {
        const fixture = spawnSync("magick", ["-size", "2x1", "xc:red", "-set", "comment", "old-note", `${extension}:-`]);
        expect(fixture.status).toBe(0);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input", fixture.stdout);
        const files = new Map([["/input", new Uint8Array(fixture.stdout)]]);
        const outputPath = `/output.${extension}`;
        const edits = ["-set", "comment", "width=%w", "-set", "label", "%[comment]-label", "-set", "asset", "new-code"];
        const args = ["/input", ...operation, ...edits, outputPath];
        if (mode === "command") {
          expect(await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} }
          })).toMatchObject({ exitCode: 0 });
        } else {
          expect(await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        }
        const output = mode === "buffered" ? files.get(outputPath)! : await fs.readFile(outputPath);
        const format = extension === "png" ? "%[comment]|%[label]|%[asset]" : "%[comment]";
        const native = spawnSync("magick", ["identify", "-quiet", "-format", format, "-"], { input: output, encoding: "utf8" });
        expect(native.status, native.stderr).toBe(0);
        expect(native.stdout).toBe(extension === "png" ? "width=2|width=2-label|new-code" : "width=2");
      });
    }
  }
}
