import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";
import fixtures from "./source-text-fixtures.json" with { type: "json" };

// Fixtures and the independent output oracle use ImageMagick, never our codecs.
for (const [extension, fixture] of Object.entries(fixtures)) {
  for (const mode of ["buffered", "retained", "command"]) {
    for (const operation of [[], ["-flop"], ["-strip"], ["-flop", "-strip"]]) {
      it(`preserves source text: ${extension}, ${mode}, ${operation.join(" ")}`, async () => {
        const input = Buffer.from(fixture, "base64"), outputPath = `/output.${extension}`;
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input", input);
        const files = new Map([["/input", new Uint8Array(input)]]);
        const args = ["/input", ...operation, outputPath];
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
        expect(native.stdout).toBe(operation.includes("-strip") ? extension === "png" ? "||" : "" : extension === "png" ? "old-note|old-label|old-code" : "old-note");
      });
    }
  }
}
