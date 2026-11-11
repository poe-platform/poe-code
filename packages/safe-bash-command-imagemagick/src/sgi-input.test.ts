import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "../../../tests/fixtures/media/sgi-input-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35: -size 4x4 xc:red xc:blue +append -depth 8 sgi:- (and png:-).
// The asymmetric 3x2 PPM fixture checks bottom-up row order and literal RLE packets.
for (const mode of ["sync", "buffered", "stored", "command"] as const) {
  for (const [name, fixture] of Object.entries(fixtures)) {
    for (const prefix of ["", name.endsWith("sgi") ? "sgi:" : "png:"]) {
      it(`decodes native ${name} with '${prefix}' input (${mode})`, async () => {
        const input = Buffer.from(fixture.input, "base64"), path = "/in." + name.slice(-3);
        const files = new Map([[path, input]]), fs = new MemoryFileSystem();
        await fs.writeFile(path, input);
        const args = [prefix + path, "-depth", "8", "rgb:-"];
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
          command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
          stdin: (async function* () {})(), stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
          : await runConvertCli(args, mode === "stored" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : undefined;
        if (!(output instanceof Uint8Array)) throw new Error("Expected binary stdout");
        expect(Buffer.from(output).toString("hex")).toBe(fixture.rgb);
        const infoArgs = [prefix + path, "-format", "%n %w %h", "info:"];
        const info = mode === "sync" ? runConvertCliSync(infoArgs, files)
          : await runConvertCli(infoArgs, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(info).toEqual({ exitCode: 0, stderr: "", stdout: name.startsWith("stripes") ? "1 8 4" : "1 3 2" });
      });
    }
  }
}
