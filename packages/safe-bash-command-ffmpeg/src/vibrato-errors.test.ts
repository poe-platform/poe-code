import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 shell statuses and PCM for 8192 mono s16le samples at 8 kHz.
for (const [option, exitCode] of [
  ["d=0.5", 0], ["d=2", 222], ["f=0", 222], ["bad=1", 8], ["d=bogus", 234], ["f=1/", 234]
] as const) {
  for (const graph of [false, true]) {
    for (const output of ["pipe:1", "/out.pcm"]) {
      it(`vibrato=${option} exits ${exitCode} (${graph ? "graph" : "simple"}, ${output})`, async () => {
        const input = Buffer.alloc(8192 * 2);
        for (let i = 0; i < 8192; i++) input.writeInt16LE(i % 30000 - 15000, i * 2);
        const volume = Volume.fromJSON({ "/in.pcm": input, "/out.pcm": "keep" });
        const filter = `vibrato=${option}`;
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.pcm",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", output],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, exitCode, stderr);
        const stdout = Buffer.concat(chunks);
        if (exitCode === 0) {
          const pcm = output === "pipe:1" ? stdout : volume.readFileSync(output) as Buffer;
          assert.equal(stderr, "");
          assert.equal(pcm.length, input.length);
          assert.equal(createHash("sha256").update(pcm).digest("hex"),
            "6fa5b8c9f323e6877288b63e322521699ad1ef5bb44ef513edc79e6389d0ce22");
        } else {
          assert.ok(stderr.includes("vibrato"), stderr);
          assert.equal(stdout.length, 0);
          assert.equal(volume.readFileSync("/out.pcm", "utf8"), "keep");
        }
        assert.deepEqual(volume.readFileSync("/in.pcm"), input);
      });
    }
  }
}
