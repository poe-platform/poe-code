import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete mono double PCM output from native FFmpeg 7.0.2 (also with -cpuflags 0).
for (const complex of [false, true]) {
  it(`matches native default aemphasis double PCM (${complex ? "graph" : "simple"})`, async () => {
    const input = Buffer.alloc(128);
    for (let i = 0; i < 16; i++) input.writeDoubleLE([0, .123456789, -.34567891, .77777777][i % 4]!, i * 8);
    const volume = Volume.fromJSON({ "/in.pcm": input });
    const output: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "f64le", "-ar", "1000", "-ac", "1", "-i", "/in.pcm",
        ...(complex ? ["-filter_complex", "[0:a]aemphasis[out]", "-map", "[out]"] : ["-af", "aemphasis"]),
        "-f", "f64le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const pcm = Buffer.concat(output);
    assert.equal(pcm.length, input.length);
    assert.equal(createHash("sha256").update(pcm).digest("hex"),
      "cb3e6505dad98016d76154a51c24b2f3a91935301c572dc0295da11f0a65c7af");
  });
}
