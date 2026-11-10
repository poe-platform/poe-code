import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: all 32 stereo PCM16 frames, at 8 kHz.
for (const [option, literal, hash] of [
  ["amount=min", "amount=0", "a9585536eb59133b1655d882327e846714aa78186133d93425866c4b4a158b0f"],
  ["amount=max", "amount=1", "3c6ebc4440a3e5cf7533667f227ce389438e48a93c16191e7eef5250ed17c308"],
  ["amount=default", "amount=1", "3c6ebc4440a3e5cf7533667f227ce389438e48a93c16191e7eef5250ed17c308"],
  ["level_in=min", "level_in=0.015625", "6abc4e3f146ff9275b7206a1d43c065eafa7d6d8d30c4159f487eca0d3e81b78"]
] as const) {
  for (const graph of [false, true]) {
    it(`apulsator ${option} and its literal match native PCM (${graph ? "graph" : "simple"})`, async () => {
      for (const value of [literal, option]) {
        const { pcm, result, stderr } = await run(value, graph);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(pcm.length, 128);
        assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
      }
    });
  }
}

for (const [key, min, max, initial] of [
  ["level_in", 0.015625, 64, 1], ["level_out", 0.015625, 64, 1],
  ["amount", 0, 1, 1], ["offset_l", 0, 1, 0], ["offset_r", 0, 1, 0.5],
  ["width", 0, 2, 1], ["bpm", 30, 300, 120], ["ms", 10, 2000, 500], ["hz", 0.01, 100, 2]
] as const) {
  it(`apulsator ${key} uses its own bounds and original default in expressions`, async () => {
    const timing = key === "bpm" || key === "ms" ? `timing=${key}:` : "";
    for (const [expression, value] of [
      ["min", min], ["max", max], ["default", initial], ["(min+max)/2", (min + max) / 2]
    ] as const) {
      const actual = await run(`${timing}${key}=${max}:${key}=${expression}`);
      const control = await run(`${timing}${key}=${value}`);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.equal(control.result.exitCode, 0, control.stderr);
      assert.deepEqual(actual.pcm, control.pcm, expression);
    }
  });
}

for (const option of ["amount=max+1", "level_in=min/2", "amount=unknown"]) {
  it(`apulsator ${option} still rejects invalid values without replacing output`, async () => {
    const { result, pcm } = await run(option);
    assert.notEqual(result.exitCode, 0);
    assert.equal(pcm.toString(), "keep");
  });
}

async function run(options: string, graph = false) {
  const volume = Volume.fromJSON({ "/out.raw": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({
    sampleRate: 8000,
    channels: [new Float64Array(32).fill(10000 / 32768), new Float64Array(32).fill(-8000 / 32768)]
  }));
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
  return { pcm: volume.readFileSync("/out.raw") as Buffer, result, stderr };
}
