import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: ffmpeg -y -v error -i nb.3gp -c:a copy nb.amr
// (and the same command for wb). References contain the original compressed frames.
for (const band of ["nb", "wb"]) {
  const input = readFileSync(new URL(`../../mp4-ast/src/fixtures/amr-copy-${band}.3gp`, import.meta.url));
  const expected = readFileSync(new URL(`../../mp4-ast/src/fixtures/amr-copy-${band}.amr`, import.meta.url));
  for (const output of ["extension", "explicit", "stdout", "limit"] as const) {
    it(`stream-copies ${band} AMR from 3GP (${output})`, async () => {
      const target = output === "stdout" ? "-" : output === "explicit" ? "/out.bin" : "/out.amr";
      const volume = Volume.fromJSON({ "/in.3gp": input, [target]: "KEEP" });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand(output === "limit" ? { limits: { maxOutputBytes: expected.length - 1 } } : {}).execute({
        args: ["-y", "-v", "error", "-i", "/in.3gp", "-c:a", "copy",
          ...(output === "explicit" || output === "stdout" ? ["-f", "amr"] : []), target],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (output === "limit") {
        assert.notEqual(result.exitCode, 0);
        assert.match(stderr, /maxOutputBytes/);
        assert.equal(volume.readFileSync(target, "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(output === "stdout" ? Buffer.concat(stdout) : volume.readFileSync(target), expected);
      }
    });
  }
}
