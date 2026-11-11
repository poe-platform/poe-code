import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: infinities are range errors, NaN is a parse error.
for (const option of ["i", "m", "f", "s"]) {
  for (const [value, exitCode] of [
    ["Inf", 222], ["-Inf", 222], ["1/0", 222], ["-1/0", 222],
    ["NaN", 234], ["0/0", 234], ["3", 222], ["2", 0]
  ] as const) {
    if (value === "2" && option !== "s") continue;
    for (const graph of [false, true]) {
      it(`deesser ${option}=${value} matches native status and PCM (graph=${graph})`, async () => {
        const fs = new Volume();
        fs.writeFileSync("/in.wav", encodeWav({
          sampleRate: 48000,
          channels: [Float64Array.from({ length: 48 }, (_, i) => ((i * 7919) % 50000 - 25000) / 32768)]
        }, { bitsPerSample: 16 }));
        const filter = `deesser=i=1:${option}=${value}`;
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "pipe:1"],
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
        const pcm = Buffer.concat(chunks);
        assert.equal(pcm.length, exitCode === 0 ? 96 : 0);
        if (exitCode === 0) {
          assert.equal(stderr, "");
          assert.equal(createHash("sha256").update(pcm).digest("hex"),
            "78406258acdac09d0672721ad3b166b7f00387ba5e39272be0830c28fddbf209");
        } else {
          assert.ok(stderr.includes(exitCode === 222 ? `deesser: invalid ${option}` : "deesser: invalid or unsupported expression"), stderr);
        }
      });
    }
  }
}
