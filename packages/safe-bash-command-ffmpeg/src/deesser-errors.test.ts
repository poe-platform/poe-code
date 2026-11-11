import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: ERANGE, EINVAL, and AVERROR_OPTION_NOT_FOUND shell statuses.
for (const [option, exitCode] of [["i=2", 222], ["s=q", 234], ["q=1", 8]] as const) {
  for (const graph of [false, true]) {
    for (const output of ["pipe:1", "/out.pcm"]) {
      it(`deesser=${option} exits ${exitCode} without output (graph=${graph}, ${output})`, async () => {
        const fs = Volume.fromJSON({ "/out.pcm": "keep" });
        fs.writeFileSync("/in.wav", encodeWav({
          sampleRate: 48000,
          channels: [Float64Array.from({ length: 384 }, (_, i) => ((i * 7919) % 50000 - 25000) / 32768)]
        }, { bitsPerSample: 16 }));
        const filter = `deesser=${option}`;
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", output],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
            async stat(path: string) { return fs.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, exitCode, stderr);
        assert.equal(Buffer.concat(chunks).length, 0);
        assert.equal(fs.readFileSync("/out.pcm", "utf8"), "keep");
      });
    }
  }
}
