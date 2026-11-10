import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function convert(filter: string, graph = false, options: string[] = []) {
  const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
  const samples = new Float64Array(512);
  samples[128] = 24000 / 32768;
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.wav",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      ...options, "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.pcm") as Buffer };
}

// Native FFmpeg 7.0.2: mono PCM16 impulse at sample 128, resampled from 8 to 4 kHz.
for (const graph of [false, true]) {
  for (const [filter, hash, options] of [
    ["aresample=4000:filter_size=8", "304400c68df07298", []],
    ["aresample=4000", "231db293e4f8c0c6", []],
    ["aresample=4000:filter_size=8", "304400c68df07298", ["-filter_size", "32"]],
    ["aresample=8000:filter_size=8,aresample=4000", "231db293e4f8c0c6", []],
    ["aresample=8000:filter_size=8", "231db293e4f8c0c6", ["-ar", "4000"]]
  ] as const) {
    it(`${filter} ${options.join(" ")} keeps filter_size stage-local (${graph ? "graph" : "simple"})`, async () => {
      const result = await convert(filter, graph, [...options]);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.output.length, 512);
      assert.equal(createHash("sha256").update(result.output).digest("hex").slice(0, 16), hash);
    });
  }
}

for (const size of [0, 1, 4, 8, 32]) {
  it(`negotiates the output rate with filter_size=${size} alone`, async () => {
    const expected = await convert("anull", false, ["-ar", "4000", "-filter_size", String(size)]);
    const result = await convert(`aresample=filter_size=${size}`, false, ["-ar", "4000"]);
    assert.equal(expected.exitCode, 0, expected.stderr);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, expected.output);
  });
}

for (const value of ["", "-1", "1.5", "2147483648", "NaN", "8=1"]) {
  it(`rejects invalid aresample filter_size=${value} without replacing output`, async () => {
    const result = await convert(`aresample=4000:filter_size=${value}`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.output.toString(), "KEEP");
    assert.ok(result.stderr.includes("filter_size"), result.stderr);
  });
}
