import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 output for 1536 deterministic input frames.
for (const [channels, hash] of [
  [2, "1939dc79f772a387d5f452053f73d6c263ee685c9cd20ac2e066b06878ac916c"],
  [4, "0a6fa54fb3f8470ca727d02abd9c6c7b7cbf50a0eb8d63325cf38fd0b365ab5b"],
  [6, "9e5a458052b7d5966ea5f14cf56d6da592e386b6e5745132a20312fceaeec38b"]
] as const) {
  for (const complex of [false, true]) {
    for (const filter of ["earwax", "aformat=channel_layouts=stereo,earwax", "anull"]) {
      it(`${channels} channels through ${filter} (${complex ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 44100,
          channels: Array.from({ length: channels }, (_, c) => Float64Array.from({ length: 1536 },
            (_, i) => ((i * 421 + c * 1709) % 12000 - 6000) / 32768)) }));
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-i", "/in.wav", ...(complex
            ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
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
        const bytes = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(bytes.length, 1536 * (filter === "anull" ? channels : 2) * 2);
        if (filter === "anull") {
          for (let i = 0; i < 1536; i++) for (let c = 0; c < channels; c++) {
            assert.equal(bytes.readInt16LE((i * channels + c) * 2), (i * 421 + c * 1709) % 12000 - 6000);
          }
        } else assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
      });
    }
  }
}
