import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: eight mono PCM16 samples at 8 kHz.
for (const [option, exitCode, pcm] of [
  ["unknown_option=1", 8, ""],
  ["type=banana", 234, ""],
  ["threshold=0", 222, ""],
  ["oversample=65", 222, ""],
  ["type=9", 222, ""],
  ["output=17", 222, ""],
  ["param=0", 222, ""],
  ["threshold=banana", 234, ""],
  ["oversample=banana", 234, ""],
  ["type=tanh", 0, "805f3ea700411dbd80251dd3a05a50f460a5af0b80dae22c00bfe24280a0c158"]
] as const) {
  for (const graph of [false, true]) {
    for (const output of ["pipe:1", "/out.pcm"]) {
      it(`asoftclip=${option} matches native status and PCM (graph=${graph}, ${output})`, async () => {
        const fs = Volume.fromJSON({ "/out.pcm": "keep" });
        fs.writeFileSync("/in.wav", encodeWav({
          sampleRate: 8000,
          channels: [Float64Array.from([-28000, -19000, -12000, -3000, 3000, 12000, 19000, 28000], sample => sample / 32768)]
        }, { bitsPerSample: 16 }));
        const filter = `asoftclip=${option}`;
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s32le", output],
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
