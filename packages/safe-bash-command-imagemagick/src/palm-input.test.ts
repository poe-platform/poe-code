import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35: magick -size 8x2 xc:black xc:white +append -depth 1 bw.palm
const input = Buffer.from("00100002000240000100000000ff0000ff00ff00", "hex");
const expected = Buffer.from([...Array(8).fill(0), ...Array(8).fill(255), ...Array(8).fill(0), ...Array(8).fill(255)]);

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const filename of ["/bw.palm", "palm:/bw.palm"]) {
    it(`reads native one-bit Palm pixels from ${filename} (${mode})`, async () => {
      const files = new Map<string, Uint8Array>([["/bw.palm", input]]), fs = new MemoryFileSystem();
      await fs.writeFile("/bw.palm", input);
      const args = [filename, "-depth", "8", "gray:-"], stdout: Uint8Array[] = [];
      let stderr = "";
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(mode === "command" ? Buffer.concat(stdout) : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : [])).toEqual(expected);
    });
  }
}
