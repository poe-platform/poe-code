import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const [name, channels, expected] of [
  ["mono", [Array.from({ length: 8 }, (_, i) => 3000 + i * 10)],
    [2121, 2128, 2135, 2142, 2150, 2157, 2164, 2171]],
  ["surround", Array.from({ length: 6 }, (_, c) => Array.from({ length: 8 }, (_, i) =>
    (2000 + c * 100 + i * 10) * (c % 2 ? -1 : 1))),
    [-958, -962, -966, -970, -974, -979, -983, -987]],
  ["stereo", [Array(8).fill(100), Array(8).fill(-200)], Array(8).fill(-200)]
] as const) {
  for (const selected of ["FL", "FR"]) {
    const samples = selected === "FR" || name === "mono" ? expected
      : name === "surround" ? [2176, 2186, 2196, 2206, 2216, 2226, 2236, 2246] : Array(8).fill(100);
    for (const graph of [false, true]) {
      it(`channelsplit remixes ${name} to stereo before selecting ${selected} (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/out.raw": "keep" });
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: channels.map(samples => Float64Array.from(samples, value => value / 32768)) }));
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]channelsplit=stereo:${selected}[right]`, "-map", "[right]"]
            : ["-af", `channelsplit=stereo:${selected}`]), "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
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
        assert.equal(bytes.length, samples.length * 2);
        assert.deepEqual(samples.map((_, i) => bytes.readInt16LE(i * 2)), samples);
      });
    }
  }
}
