import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 s16le output for the 6400-frame stereo PCM16 fixture below.
for (const [options, named, sha256] of [
  ["level_in=1:level_in=1:0.25", "level_in=0.25", "aaf630c1fddc05613ec66d514120a58ec6a36a563e3ef47c57e6936c9c9b05f1"],
  ["0.5:level_in=1:0.25", "level_in=0.25", "aaf630c1fddc05613ec66d514120a58ec6a36a563e3ef47c57e6936c9c9b05f1"],
  ["1:level_in=1:2", "level_in=2", "fa4bf088f7430863e4fa63c356c117e052fdd633b2e8edc438286e6b6337583a"],
  ["0.25", "level_in=0.25", "aaf630c1fddc05613ec66d514120a58ec6a36a563e3ef47c57e6936c9c9b05f1"],
  ["1:downward:0.25", "level_in=1:range=0.25", "2b52621df80da6f2170cf98cabda4c9a64578d9310bc24e7a0b99bc502ee5aa9"]
] as const) {
  for (const graph of [false, true]) {
    it(`agate=${options} matches named options and native PCM (${graph ? "graph" : "simple"})`, async () => {
      for (const value of [named, options]) {
        const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
          Float64Array.from({ length: 6400 }, (_, i) => ((i * 131) % 4001 - 2000) * [1, 6, 2, 0][Math.floor(i / 512) % 4]! / 32768),
          Float64Array.from({ length: 6400 }, (_, i) => ((i * 47) % 1801 - 900) * [2, 1, 16, 0][Math.floor(i / 512) % 4]! / 32768)
        ] }));
        let stderr = "";
        const filter = `agate=${value}`;
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, `${filter}: ${stderr}`);
        const bytes = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(bytes.length, 25600);
        assert.equal(createHash("sha256").update(bytes).digest("hex"), sha256, filter);
      }
    });
  }
}
