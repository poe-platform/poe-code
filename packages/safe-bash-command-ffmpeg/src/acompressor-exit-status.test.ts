import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: eight mono PCM16 samples of 8000 at 8 kHz.
for (const [option, exitCode, pcm] of [
  ["ratio=21", 222, ""],
  ["threshold=bad", 234, ""],
  ["unknown=1", 8, ""],
  ["enable=0", 176, ""],
  ["ratio=20", 0, "401f401f401f3f1f071fa11e261ea21d"]
] as const) {
  for (const graph of [false, true]) {
    for (const output of ["pipe:1", "/out.pcm"]) {
      it(`acompressor=${option} matches native status and PCM (graph=${graph}, ${output})`, async () => {
        const fs = Volume.fromJSON({ "/out.pcm": "keep" });
        fs.writeFileSync("/in.wav", encodeWav({
          sampleRate: 8000,
          channels: [new Float64Array(8).fill(8000 / 32768)]
        }, { bitsPerSample: 16 }));
        const filter = `acompressor=${option}`;
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
        assert.equal(Buffer.concat(chunks).toString("hex"), output === "pipe:1" ? pcm : "");
        assert.equal((fs.readFileSync("/out.pcm") as Buffer).toString("hex"),
          output === "/out.pcm" && exitCode === 0 ? pcm : Buffer.from("keep").toString("hex"));
      });
    }
  }
}
