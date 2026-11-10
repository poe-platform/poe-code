import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM after reinterpreting this 8 kHz input and trimming to one second.
for (const [rate, samples, hash] of [
  [4000.5, 4000, "b17c15a893a1fe3f73e27b5f14b99a9a6dd0bb97ffda165593d9738427ae8f0b"],
  [4000, 4000, "b17c15a893a1fe3f73e27b5f14b99a9a6dd0bb97ffda165593d9738427ae8f0b"],
  [4001.5, 4002, "155b3286a5269f18647274d7eb08e8c316509cc4190c18487dccc50e588e5648"],
  [4002, 4002, "155b3286a5269f18647274d7eb08e8c316509cc4190c18487dccc50e588e5648"]
] as const) {
  for (const option of ["", "r=", "sample_rate="]) {
    for (const graph of [false, true]) {
      const filter = `asetrate=${option}${rate},atrim=end=1,ashowinfo`;
      it(`${filter} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from({ length: 4707 }, (_, i) => (i - 2000) / 32768)] }));
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "info", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const pcm = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(pcm.length, samples * 2);
        assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
      });
    }
  }
}
