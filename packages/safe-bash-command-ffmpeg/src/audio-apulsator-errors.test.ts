import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: four stereo PCM16 frames of (12000, -16000) at 1 kHz.
for (const [option, exitCode, pcm] of [
  ["mode=5", 222, ""],
  ["amount=2", 222, ""],
  ["amount=oops", 234, ""],
  ["bogus=1", 8, ""],
  ["enable=1", 176, ""],
  ["mode=4", 0, "e02ec0e0c82ee0e0b02e00e1982e20e1"],
  ["amount=1", 0, "7017c0e0bb1725e1071889e15218eee1"]
] as const) {
  for (const graph of [false, true]) {
    for (const output of ["pipe:1", "/out.pcm"]) {
      it(`apulsator=${option} matches native status and PCM (graph=${graph}, ${output})`, async () => {
        const fs = Volume.fromJSON({ "/out.pcm": "keep" });
        fs.writeFileSync("/in.wav", encodeWav({
          sampleRate: 1000,
          channels: [new Float64Array(4).fill(12000 / 32768), new Float64Array(4).fill(-16000 / 32768)]
        }, { bitsPerSample: 16 }));
        const filter = `apulsator=${option}`;
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
