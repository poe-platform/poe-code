import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native Linux FFmpeg 7.0.2 statuses and PCM16 output.
for (const [filter, exitCode] of [
  ["asetnsamples=n=8:p=0,stereowiden=delay=0.5", 222],
  ["asetnsamples=n=8:p=0,stereowiden=fake=1", 8],
  ["stereowiden=delay=oops", 234],
  ["asetnsamples=n=8:p=0,stereowiden=delay=1", 0]
] as const) {
  it(`matches native status and destination for ${filter}`, async () => {
    const input = Buffer.alloc(288);
    for (let i = 0; i < 72; i++) {
      input.writeInt16LE((i * 2341) % 24000 - 12000, i * 4);
      input.writeInt16LE((i * 1793 + 8000) % 30000 - 15000, i * 4 + 2);
    }
    const volume = Volume.fromJSON({ "/in.raw": input, "/out": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2",
        "-i", "/in.raw", "-af", filter, "-f", "s16le", "/out"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    const output = volume.readFileSync("/out") as Buffer;
    if (exitCode !== 0) assert.deepEqual(output, Buffer.from("KEEP"));
    assert.equal(result.exitCode, exitCode, stderr);
    if (exitCode === 0) {
      assert.equal(output.length, 288);
      assert.equal(createHash("sha256").update(output).digest("hex"),
        "205e332d41aa8f7d101c8267eae669090b3b45331395a775d3b9dc86934a185a");
    }
  });
}
