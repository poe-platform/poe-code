import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 s16le output for eight stereo PCM16 frames at 8000 Hz.
for (const [mixed, named, hex] of [
  ["asubboost=1:wet=1:0.5", "asubboost=dry=0.5:wet=1", "00c0401f60f07017d007a00f7017d007401f30f8701760f0a00f90e8d007c0e0"],
  ["asubboost=1:wet=0.5:0.75", "asubboost=dry=0.75:wet=0.5", "00d0701748f49411dc05b80b9411dc05701724fa941148f4b80b6ceedc0590e8"]
] as const) {
  for (const graph of [false, true]) {
    it(`${mixed} matches named options and native PCM (graph=${graph})`, async () => {
      for (const filter of [named, mixed]) {
        const volume = Volume.fromJSON({ "/out": "KEEP" });
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
          Float64Array.from([-32768, -8000, 4000, 12000, 16000, 12000, 8000, 4000], value => value / 32768),
          Float64Array.from([16000, 12000, 8000, 4000, -4000, -8000, -12000, -16000], value => value / 32768)
        ] }));
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out"],
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
        assert.equal((volume.readFileSync("/out") as Buffer).toString("hex"), hex);
      }
    });
  }
}
