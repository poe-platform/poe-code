import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16: 32 stereo frames of (10000, -8000) at 8 kHz.
for (const [options, hash] of [
  ["mode=triangle+1", "cf5041516328ccc6e5a23f5884d85e2936f6fb1c06b64502d9f5f504c6f0a929"],
  ["mode=square", "cf5041516328ccc6e5a23f5884d85e2936f6fb1c06b64502d9f5f504c6f0a929"],
  ["mode=1+0", "e157038f29c75fe7f9de3a35382f66bf27a8819b354459b83aae76c2a91bbd98"],
  ["mode=triangle", "e157038f29c75fe7f9de3a35382f66bf27a8819b354459b83aae76c2a91bbd98"],
  ["timing=ms+0:ms=10", "f9c963ea71eb7d574c264cc6783feb3703b4e5de21979b0eb9aa036e23acf579"],
  ["timing=0x1:ms=10", "f9c963ea71eb7d574c264cc6783feb3703b4e5de21979b0eb9aa036e23acf579"],
  ["timing=ms:ms=10", "f9c963ea71eb7d574c264cc6783feb3703b4e5de21979b0eb9aa036e23acf579"]
] as const) {
  for (const graph of [false, true]) {
    it(`apulsator=${options} matches all native PCM frames (${graph ? "graph" : "simple"})`, async () => {
      const { result, stderr, bytes } = await run(options, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(bytes.length, 32 * 2 * 2);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
    });
  }
}

for (const [options, control] of [
  ...["sine", "triangle", "square", "sawup", "sawdown"].map(mode => [`mode=${mode}+0`, `mode=${mode}`]),
  ...["bpm", "ms", "hz"].map(timing => [`timing=${timing}+0:bpm=180:ms=10:hz=7`, `timing=${timing}:bpm=180:ms=10:hz=7`]),
  ["mode=triangle/2", "mode=sine"],
  ["mode=triangle+0.5", "mode=square"],
  ["mode=square+0.5", "mode=square"],
  ["mode=sawup+0.5", "mode=sawdown"],
  ["timing=ms/2:bpm=180", "timing=bpm:bpm=180"],
  ["timing=ms+0.5:hz=7", "timing=hz:hz=7"],
  ["1:1:triangle+1", "mode=square"],
  ["1:1:sine:1:0:0.5:1:ms+0:120:10", "timing=ms:ms=10"]
]) {
  it(`apulsator=${options} matches ${control}`, async () => {
    const expected = await run(control!);
    assert.equal(expected.result.exitCode, 0, expected.stderr);
    const actual = await run(options!);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.deepEqual(actual.bytes, expected.bytes);
  });
}

for (const options of [
  "mode=triangle-2", "mode=sawdown+0.1", "mode=1/0", "mode=0/0", "mode=ms+0",
  "timing=bpm-0.1", "timing=hz+0.1", "timing=1/0", "timing=0/0", "timing=sine+0"
]) {
  it(`apulsator=${options} rejects invalid enum expressions without replacing output`, async () => {
    const { result, bytes } = await run(options);
    assert.notEqual(result.exitCode, 0);
    assert.equal(bytes.toString(), "keep");
  });
}

async function run(options: string, graph = false) {
  const volume = Volume.fromJSON({ "/out.raw": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    new Float64Array(32).fill(10000 / 32768),
    new Float64Array(32).fill(-8000 / 32768)
  ] }));
  let stderr = "";
  const filter = `apulsator=${options}`;
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
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
  return { result, stderr, bytes: volume.readFileSync("/out.raw") as Buffer };
}
