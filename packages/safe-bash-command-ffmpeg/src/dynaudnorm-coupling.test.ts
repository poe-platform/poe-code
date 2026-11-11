import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(options: string, graph: boolean, scales = [1, 4], length = 120) {
  const samples = Float64Array.from({ length }, (_, i) =>
    (i % 2 ? 1 : -1) * (i < 60 ? 500 : 5000) / 32768);
  const fs = Volume.fromJSON({ "/out.pcm": "keep", "/in.wav": Buffer.from(encodeWav({
    sampleRate: 1000, channels: scales.map(scale => samples.map(value => value * scale))
  })) });
  const filter = `dynaudnorm=f=10:g=3${options}`;
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
      : ["-af", filter]), "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); } },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, pcm: fs.readFileSync("/out.pcm") as Buffer };
}

for (const graph of [false, true]) {
  // Native FFmpeg 7.0.2: stereo PCM16 with a 4:1 level ratio and a step at 60 ms.
  for (const [options, hash, left] of [
    ["", "edd66bebed21c08fa8edd22df980ee19488921dd9a5cfbe84cd3659a2a1fb33a", 7733],
    [":n=1", "edd66bebed21c08fa8edd22df980ee19488921dd9a5cfbe84cd3659a2a1fb33a", 7733],
    [":coupling=1", "edd66bebed21c08fa8edd22df980ee19488921dd9a5cfbe84cd3659a2a1fb33a", 7733],
    [":n=0", "3e270dab43d4e7406703530e4ef37ec68d87c22186749c0fb3c264634efc6945", 28239],
    [":coupling=0", "3e270dab43d4e7406703530e4ef37ec68d87c22186749c0fb3c264634efc6945", 28239],
    [":n=off", "3e270dab43d4e7406703530e4ef37ec68d87c22186749c0fb3c264634efc6945", 28239],
    [":coupling=on", "edd66bebed21c08fa8edd22df980ee19488921dd9a5cfbe84cd3659a2a1fb33a", 7733]
  ] as const) it(`dynaudnorm${options} matches native coupling PCM (${graph ? "graph" : "simple"})`, async () => {
    const result = await run(options, graph);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.pcm.length, 480);
    assert.equal(result.pcm.readInt16LE(85 * 4), left);
    assert.equal(result.pcm.readInt16LE(85 * 4 + 2), 30933);
    assert.equal(createHash("sha256").update(result.pcm).digest("hex"), hash);
  });

  for (const length of [7, 117]) {
    it(`uncoupled channels match independent mono normalization through EOF at ${length} samples (${graph ? "graph" : "simple"})`, async () => {
      const scales = [1, 0, -4];
      const combined = await run(":n=0", graph, scales, length);
      assert.equal(combined.exitCode, 0, combined.stderr);
      assert.equal(combined.pcm.length, length * scales.length * 2);
      for (const [channel, scale] of scales.entries()) {
        const mono = await run("", graph, [scale], length);
        assert.equal(mono.exitCode, 0, mono.stderr);
        for (let i = 0; i < length; i++) {
          assert.equal(combined.pcm.readInt16LE((i * scales.length + channel) * 2), mono.pcm.readInt16LE(i * 2));
        }
      }
    });
  }

  for (const option of ["n=2", "coupling=-1", "n=0.5", "n=1/0", "n=unknown"]) {
    it(`dynaudnorm rejects ${option} without replacing output (${graph ? "graph" : "simple"})`, async () => {
      const result = await run(`:${option}`, graph);
      assert.equal(result.exitCode, 1);
      assert.equal(result.pcm.toString(), "keep");
    });
  }
}
