import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 status and complete interleaved PCM16 output.
const cases = [
  ["channelmap=0|1:FR+FL,apulsator=hz=100", 234, ""],
  ["channelmap=0|1:FR+FR,apulsator=hz=100", 234, ""],
  ["channelmap=0|1:FL+FC,apulsator=hz=100", 234, ""],
  ["channelmap=0|1:BL+BR,apulsator=hz=100", 234, ""],
  ["channelmap=0|1:2C,apulsator=hz=100", 0, "7017c0e037251ef3ba2d78feba2d78fe"],
  ["channelmap=0|1:FL+FR,apulsator=hz=100", 0, "7017c0e037251ef3ba2d78feba2d78fe"],
  ["channelmap=0|1:FR+FL,channelmap=FL|FR:stereo,apulsator=hz=100", 0, "c0e0701762cea90908c3260108c32601"],
  ["channelmap=0|1:FR+FL", 0, "e02e80c1e02e80c1e02e80c1e02e80c1"]
] as const;

for (const graph of [false, true]) {
  for (const [filter, status, hex] of cases) {
    it(`${filter} matches native layout negotiation (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 1000,
        channels: [12000, -16000].map(value => new Float64Array(4).fill(value / 32768)) }));
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, status, stderr);
      assert.equal(Buffer.concat(stdout).toString("hex"), hex);
    });
  }
}
