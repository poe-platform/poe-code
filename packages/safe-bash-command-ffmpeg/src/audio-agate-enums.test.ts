import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(options: string, graph = false) {
  const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
  const channels = [
    Float64Array.from({ length: 6400 }, (_, i) => ((i * 131) % 4001 - 2000) * [1, 6, 2, 0][Math.floor(i / 512) % 4]! / 32768),
    Float64Array.from({ length: 6400 }, (_, i) => ((i * 47) % 1801 - 900) * [2, 1, 16, 0][Math.floor(i / 512) % 4]! / 32768)
  ];
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
  let stderr = "";
  const filter = `agate=${options}`;
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: fs.readFileSync("/out.raw") as Buffer };
}

// Native FFmpeg 7.0.2 PCM16 hashes for this stereo fixture.
for (const [options, hash] of [
  ["mode=1.0", "6c38e63c62fc896ce187dfaff64be33c2e74ec43996f41961ee4debc495b6a08"],
  ["link=0.5", "080a910cf94a6c0fb40d244fbad9515d2ac1d1d14176886ba64b35076e9c06dc"],
  ["link=0.6", "4f0a0862ea395c385ed321db215f4d4fbd51763bd0bd3847ae77fdff66760373"],
  ["link=average+1", "4f0a0862ea395c385ed321db215f4d4fbd51763bd0bd3847ae77fdff66760373"]
] as const) for (const graph of [false, true]) {
  it(`agate=${options} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
    const { result, stderr, output } = await run(options, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(output.length, 25600);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}

for (const [key, low, high] of [
  ["mode", "downward", "upward"], ["link", "average", "maximum"], ["detection", "peak", "rms"]
] as const) {
  it(`agate ${key} evaluates expressions and rounds ties to even`, async () => {
    const lower = await run(`${key}=${low}`);
    const upper = await run(`${key}=${high}`);
    assert.equal(lower.result.exitCode, 0, lower.stderr);
    assert.equal(upper.result.exitCode, 0, upper.stderr);
    assert.notDeepEqual(lower.output, upper.output);
    for (const [value, expected] of [
      ["0", lower.output], ["1", upper.output], ["0.0", lower.output], ["1.0", upper.output],
      ["0.49", lower.output], ["0.5", lower.output], ["0.5001", upper.output],
      [`${low}+1`, upper.output], [`${high}/2`, lower.output], [`${high}-1`, lower.output]
    ] as const) {
      const actual = await run(`${key}=${value}`);
      assert.equal(actual.result.exitCode, 0, `${value}: ${actual.stderr}`);
      assert.deepEqual(actual.output, expected, value);
    }
  });

  for (const value of ["-0.1", "1.1", "2", "", "unknown", "NaN", "1/0", "0/0", "1+"]) {
    it(`agate rejects ${key}=${value} without replacing output`, async () => {
      const { result, stderr, output } = await run(`${key}=${value}`);
      assert.equal(result.exitCode, ["-0.1", "1.1", "2"].includes(value) ? 222 : 234, stderr);
      assert.ok(stderr.includes("agate:"), stderr);
      assert.equal(output.toString(), "KEEP");
    });
  }
}
