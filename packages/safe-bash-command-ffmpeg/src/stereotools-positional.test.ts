import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const left = [4096, 8192, -2000, 0];
const right = [1024, -4096, 3000, 1000];
for (const [positional, named] of [
  ["1:1:0:0:0:0:1", "muter=1"],
  ["1:1:0:0:0:0:1:", "muter=1"],
  ["1:1:muter=1:", "muter=1"],
  ["1:1:0:0:0:1", "mutel=1"],
  ["2:0.5", "level_in=2:level_out=0.5"],
  ["1:1:0:0:0:0:0:1:1:lr>rl", "phasel=1:phaser=1:mode=lr>rl"],
  ["1:1:0:0:0:0:0:0:0:0:0.5:0.25:2:-0.25:0.5:0:1:90:1:2",
    "slev=0.5:sbal=0.25:mlev=2:mpan=-0.25:base=0.5:phase=90:bmode_in=1:bmode_out=2"],
  ["1:1:0.25:-0.25:1:0:0:0:0:0:1:0:1:0:0:0.25:2:0:1:2",
    "balance_in=0.25:balance_out=-0.25:softclip=1:delay=0.25:sclevel=2:bmode_in=1:bmode_out=2"],
  ["1:1:0:0:0:0:1:muter=0:phasel=1", "muter=0:phasel=1"]
] as const) {
  for (const complex of [false, true]) {
    it(`matches named stereotools arguments (${complex ? "graph" : "simple"}): ${positional}`, async () => {
      const results = [];
      for (const expression of [positional, named]) {
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: [left, right].map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
        let stderr = "";
        const filters = complex
          ? ["-filter_complex", `[0:a]stereotools=${expression}[s]`, "-map", "[s]"]
          : ["-af", `stereotools=${expression}`];
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav", ...filters, "/out.wav"],
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
        const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
        assert.equal(audio.channels, 2);
        assert.equal(audio.sampleRate, 8000);
        results.push(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)));
      }
      assert.deepEqual(results[0], results[1]);
      if (named === "muter=1") assert.deepEqual(results[0], [left, [0, 0, 0, 0]]);
    });
  }
}

for (const expression of [
  "1:1:0:0:0:0:2",
  "65",
  "level_in=1:1",
  "muter=1::",
  "muter=1::phasel=1",
  "muter=1:1:",
  "mode=:",
  "unknown=1:",
  "1:1:0:0:0:0:0:0:0:0:1:0:1:0:0:0:1:0:0:0:0"
]) {
  it(`rejects invalid stereotools positional arguments without replacing output: ${expression}`, async () => {
    const volume = Volume.fromJSON({ "/out.wav": "keep" });
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [left, right].map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav", "-af", `stereotools=${expression}`, "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}
