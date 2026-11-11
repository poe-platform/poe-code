import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, graph: boolean, length = 120) {
  const fs = Volume.fromJSON({ "/out.pcm": "keep" });
  const samples = Float64Array.from({ length }, (_, i) =>
    (i % 2 ? 1 : -1) * (i < 60 ? 500 : 5000) / 32768);
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 1000,
    channels: [samples, samples.map(value => value * 4)] }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, pcm: fs.readFileSync("/out.pcm") as Buffer, stderr };
}

// Native FFmpeg 7.0.2 references: stereo PCM16, a 4:1 channel level ratio,
// and a tenfold increase in level at 60 ms.
for (const graph of [false, true]) {
  for (const [options, suffix, bytes, sha256] of [
    ["", "", 480, "edd66bebed21c08fa8edd22df980ee19488921dd9a5cfbe84cd3659a2a1fb33a"],
    [":o=0", "", 480, "edd66bebed21c08fa8edd22df980ee19488921dd9a5cfbe84cd3659a2a1fb33a"],
    [":o=0.5", "", 480, "3901390538b725481ad57bebc3879aa548a3d81331288ed41ada26ac38bb9c34"],
    [":overlap=0.5", "", 480, "3901390538b725481ad57bebc3879aa548a3d81331288ed41ada26ac38bb9c34"],
    [":o=1/2", "", 480, "3901390538b725481ad57bebc3879aa548a3d81331288ed41ada26ac38bb9c34"],
    ["", ",aselect='eq(n,0)'", 40, "1d3e3bb4eefa4c9f39129cc739c4861258e24a439895c03608f8c5186ceea39e"],
    [":o=0.5", ",aselect='eq(n,0)'", 20, "8fd66eb18da102a875c7bc9eec9c9e4034496e3c392974f246b91461e8eafebc"]
  ] as const) {
    it(`dynaudnorm=f=10:g=3${options}${suffix} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
      const result = await run(`dynaudnorm=f=10:g=3${options}${suffix}`, graph);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.pcm.length, bytes);
      assert.equal(createHash("sha256").update(result.pcm).digest("hex"), sha256);
    });
  }

  for (const [length, options, sha256] of [
    [120, "o=0.25", "66e768a5a7496b785f07397cb0af9bce0a1cb8ea199de40d2076d121bfefef92"],
    [120, "o=0.75", "15a4873616346428461d43ab401f624e4d501938bcdb3bf81ce92ed89430ef87"],
    [120, "o=1", "187cb11f6e1a3ec4e43e4a914e67912a46a78ef7e1bd98d8d344d7d8744ffa8b"],
    [3, "o=0.5", "7398fdd9069d9363a783a7f7e9382f9fb9ad1673d1c597a83aada2e8f97e4a7f"],
    [123, "o=0.5", "0a1c708140ba80af744ea7870bc74e9b4a7b490d6d5de9e24f26c653e5805670"],
    [120, "o=0.75:p=0.1", "31f74ac4d0df662c63c9fcc6b4dd3248f24f2b0d0fb72ea617873c11efdd7490"],
    [120, "o=0.5:r=0.2", "af4cb351b3b39d2b43b4a13a40f0ef0b6c1b07ed83b262ba10b305d67c074071"],
    [123, "o=0.75:r=0.1", "f30fb124af6cd163172ab2022973ab934999586e85282ea870abb04182025b79"],
    [3, "o=0.5:r=0.01", "c2839c46a8f8d5bcc92d924945062c91d912b4c3118a05d9ad207a774a4c584f"]
  ] as const) {
    it(`dynaudnorm ${options} preserves native PCM through EOF at ${length} samples (${graph ? "graph" : "simple"})`, async () => {
      const result = await run(`dynaudnorm=f=10:g=3:${options}`, graph, length);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.pcm.length, length * 4);
      assert.equal(createHash("sha256").update(result.pcm).digest("hex"), sha256);
    });
  }

  for (const [overlap, frameSize] of [[0.25, 8], [0.5, 5], [0.75, 2], [1, 1]] as const) {
    it(`dynaudnorm overlap ${overlap} preserves shifted frame timestamps and final frame selection (${graph ? "graph" : "simple"})`, async () => {
      const filter = `asetpts=PTS+1000,dynaudnorm=f=10:g=3:o=${overlap}`;
      const result = await run(`${filter},ashowinfo`, graph, 123);
      assert.equal(result.exitCode, 0, result.stderr);
      const frames = result.stderr.split("\n").filter(line => line.includes("nb_samples:"));
      assert.equal(frames.length, Math.ceil(123 / frameSize));
      for (const [n, line] of frames.entries()) {
        assert.ok(line.includes(`n:${n} pts:${1000 + n * frameSize} `), line);
        assert.ok(line.includes(`nb_samples:${Math.min(frameSize, 123 - n * frameSize)} `), line);
      }
      const last = frames.length - 1;
      const selected = await run(`${filter},aselect='eq(n,${last})'`, graph, 123);
      assert.equal(selected.exitCode, 0, selected.stderr);
      assert.deepEqual(selected.pcm, result.pcm.subarray(last * frameSize * 4));
    });
  }

  for (const value of ["-0.01", "1.01", "NaN", "1/0", ""]) {
    it(`dynaudnorm rejects overlap ${value} without replacing output (${graph ? "graph" : "simple"})`, async () => {
      const result = await run(`dynaudnorm=o=${value}`, graph);
      assert.equal(result.exitCode, 1);
      assert.equal(result.pcm.toString(), "keep");
    });
  }
}
