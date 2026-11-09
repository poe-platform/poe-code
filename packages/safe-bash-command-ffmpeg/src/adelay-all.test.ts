import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const channels = [[1000, 2000, 3000, 4000], [-4000, -3000, -2000, -1000]];

for (const [value, all] of [
  ["TrUe", true], ["YeS", true], ["On", true],
  ["TRUE", true], ["YES", true], ["ON", true],
  ["true", true], ["yes", true], ["on", true], ["1", true],
  ["FaLsE", false], ["nO", false], ["oFf", false],
  ["FALSE", false], ["NO", false], ["OFF", false],
  ["false", false], ["no", false], ["off", false], ["0", false],
  ["maybe", null], ["MaYbE", null], ["", null]
] as const) {
  for (const graph of [false, true]) {
    for (const named of [false, true]) {
      const filter = `adelay=2S:${named ? "all=" : ""}${value}`;
      it(`${filter} matches native boolean semantics (${graph ? "graph" : "simple"})`, async () => {
        const volume = new Volume();
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: channels.map(channel => Float64Array.from(channel, sample => sample / 32768)) }));
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-c:a", "pcm_s16le", "/out.wav"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (all === null) {
          assert.equal(result.exitCode, 1);
          assert.ok(stderr.includes("adelay: invalid all option"), stderr);
          return;
        }
        assert.equal(result.exitCode, 0, stderr);
        const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
        assert.equal(audio.sampleRate, 8000);
        assert.equal(audio.channelData.length, 2);
        assert.deepEqual(Array.from(audio.channelData[0]!, sample => Math.round(sample * 32768)),
          [0, 0, ...channels[0]!]);
        assert.deepEqual(Array.from(audio.channelData[1]!, sample => Math.round(sample * 32768)),
          all ? [0, 0, ...channels[1]!] : [...channels[1]!, 0, 0]);
      });
    }
  }
}
