import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 logs through the private silencedetect context, without instance names.
for (const name of ["", "@quiet"]) {
  it(`keeps the native silencedetect log prefix for ${name || "an unnamed filter"}`, async () => {
    const input = Buffer.alloc(48);
    const volume = Volume.fromJSON({ "/in.raw": input });
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "1000",
        "-ac", "2", "-i", "/in.raw", "-af", `silencedetect${name}=d=2ms`, "-f", "s16le", "-"],
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
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(Buffer.concat(stdout), input);
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
    assert.deepEqual(stderr.trim().split("\n"), [
      "[silencedetect @ 0] silence_start: 0",
      "[silencedetect @ 0] silence_end: 0.012 | silence_duration: 0.012"
    ]);
  });
}
