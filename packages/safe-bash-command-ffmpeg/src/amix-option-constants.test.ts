import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 output, including three samples after input two ends.
for (const [options, expected] of [
  ["duration=min", "9600a7fd1c04d709f609bd0b59f1"],
  ["duration=0", "9600a7fd1c04d709f609bd0b59f1"],
  ["duration=default", "9600a7fd1c04d709f609bd0b59f1"],
  ["inputs=default", "9600a7fd1c04d709f609bd0b59f1"],
  ["inputs=min+1", "9600a7fd1c04d709f609bd0b59f1"],
  ["inputs=2", "9600a7fd1c04d709f609bd0b59f1"],
  ["inputs=max-32765", "9600a7fd1c04d709f609bd0b59f1"],
  ["dropout_transition=min", "9600a7fd1c04d709eb137917b3e2"],
  ["dropout_transition=0", "9600a7fd1c04d709eb137917b3e2"],
  ["dropout_transition=default", "9600a7fd1c04d709f609bd0b59f1"],
  ["dropout_transition=2", "9600a7fd1c04d709f609bd0b59f1"],
  ["dropout_transition=max", "9600a7fd1c04d709f609bc0b5af1"],
  ["dropout_transition=2147483647", "9600a7fd1c04d709f609bc0b5af1"],
  ["default:min:min", "9600a7fd1c04d709eb137917b3e2"],
  ["inputs=min-1", null],
  ["inputs=max+1", null],
  ["duration=min-1", null],
  ["dropout_transition=min-1", null],
  ["dropout_transition=max+1", null]
] as const) {
  it(`matches native amix option constants: ${options}`, async () => {
    const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
    volume.writeFileSync("/i0.s16le", Buffer.from("e9032df8bd0ba70feb137917b3e2", "hex"));
    volume.writeFileSync("/i1.s16le", Buffer.from("43fd21037bfc0704", "hex"));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y",
        "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/i0.s16le",
        "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/i1.s16le",
        "-filter_complex", `[0:a][1:a]amix=${options}[o]`, "-map", "[o]", "-f", "s16le", "/out.pcm"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, expected === null ? 222 : 0, stderr);
    assert.equal(volume.readFileSync("/out.pcm").toString(expected === null ? "utf8" : "hex"), expected ?? "KEEP");
  });
}
