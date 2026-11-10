import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const input = encodeWav({ sampleRate: 8000,
  channels: [0, 1].map(channel => Float64Array.from({ length: 1536 }, (_, i) =>
    ((i * 421 + channel * 1709) % 12000 - 6000) / 32768)) });

for (const complex of [false, true]) {
  // Native FFmpeg 7.0.2 hashes for the stereo PCM16 input above.
  for (const [expression, literal, hash] of [
    ["PI/2", "1.5707963267948966", "6896bd7599551262c81d9ce8b4d02dc30a53169718cb557ab0c2d33fc1d32212"],
    ["E", "exp(1)", "83797135786bbe7b9e338d9be24f628a1451919e0afc95f959cec5d9a333b6b4"],
    ["PHI", "1.618033988749895", "13f3cf02cb67bfe95dcd75ffdec275018c6be3cd57baca7beb763bc022075af8"]
  ] as const) {
    for (const option of [`level_in=${expression}`, expression, `level_in=${literal}`]) {
      it(`haas=${option} matches native PCM (${complex ? "graph" : "simple"})`, async () => {
        const { result, stderr, output } = await run(option, complex);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(output.length, 6144);
        assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      });
    }
  }

  for (const [option, literal] of [
    ["level_out=PI/2:side_gain=E:left_gain=PHI:right_gain=PI", "level_out=1.5707963267948966:side_gain=2.718281828459045:left_gain=1.618033988749895:right_gain=3.141592653589793"],
    ["left_delay=PI:right_delay=E:left_balance=-PHI/2:right_balance=PHI/2", "left_delay=3.141592653589793:right_delay=2.718281828459045:left_balance=-0.8090169943749475:right_balance=0.8090169943749475"],
    ["middle_source=mid+PI/PI", "middle_source=side"]
  ] as const) {
    it(`haas=${option} matches literal options (${complex ? "graph" : "simple"})`, async () => {
      const actual = await run(option, complex);
      const expected = await run(literal, complex);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      assert.deepEqual(actual.output, expected.output);
    });
  }

  for (const option of ["level_in=pi", "level_in=PI*100", "left_balance=PHI", "middle_source=E+PI", "left_phase=PI"]) {
    it(`haas=${option} rejects invalid values and preserves output (${complex ? "graph" : "simple"})`, async () => {
      const { result, stderr, output } = await run(option, complex);
      assert.notEqual(result.exitCode, 0);
      assert.ok(stderr.includes("haas:"), stderr);
      assert.equal(output.toString(), "KEEP");
    });
  }
}

async function run(option: string, complex: boolean) {
  const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
  volume.writeFileSync("/in.wav", input);
  let stderr = "";
  const filter = `haas=${option}`;
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav",
      ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}
