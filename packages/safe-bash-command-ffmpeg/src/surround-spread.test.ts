import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(1536 * 4);
for (let i = 0; i < 1536; i++) {
  input.writeInt16LE((i % 128 < 64 ? 1 : -1) * 900, i * 4);
  input.writeInt16LE(((i + 13) % 128 < 64 ? 1 : -1) * 600 + (i % 16 < 8 ? 1 : -1) * 200, i * 4 + 2);
}
async function run(options: string, graph = false) {
  const fs = Volume.fromJSON({ "/in.raw": input });
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const filter = `surround=win_size=1024${options ? `:${options}` : ""}`;
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return fs.readFileSync(path); },
      async stat(path: string) { return fs.statSync(path); } },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, pcm: Buffer.concat(chunks) };
}

// Native FFmpeg 7.0.2 PCM16 hashes: all 1536 frames, in FL/FR/FC/LFE/BL/BR order.
for (const [options, hash] of [
  ["", "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
  ["flx=0.5", "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
  ["flx=2", "c83f90adf74c766e9b868ce0705782ef906a96814fa2f737eac72b5c2bc7dccc"],
  ["fry=2", "0158f88b29a7d753df57a4fc93fe696f95d94738d7c798b2521e9d5f3077c0cb"],
  ["flx=2:fry=2", "2da6ab4429f37fe6b35dd36dedf55a8a735de9c568dfa2c19403198b88e4d2b9"],
  ["allx=2", "c6b74657c3040c84b2036e012dab5529ae362295a3f259d2807c942a01ced73a"],
  ["ally=2", "6bbec8a6a10cceae1e848c7a41a1bd5ce98edd32e488bac059f463fff4fbc745"],
  ["fl_out=0", "8f7993a6dda3bc73c7423d720c1f60f365bfdecaefabb43af4e95980eb9d5be6"]
]) for (const graph of [false, true]) {
  it(`surround ${options || "defaults"} matches native PCM (graph=${graph})`, async () => {
    const { result, stderr, pcm } = await run(options!, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(pcm.length, 18432);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}

for (const axis of ["x", "y"]) {
  it(`global ${axis} spread overrides speaker settings in either order`, async () => {
    const expected = await run(`all${axis}=2`);
    for (const options of [`all${axis}=2:fl${axis}=3`, `fl${axis}=3:all${axis}=2`]) {
      const actual = await run(options);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.deepEqual(actual.pcm, expected.pcm);
    }
  });
  for (const [speaker, channel] of [["fl", 0], ["fr", 1], ["fc", 2], ["bl", 4], ["br", 5]] as const) {
    it(`${speaker}${axis} changes only its speaker`, async () => {
      const control = await run("");
      const actual = await run(`${speaker}${axis}=2`);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      const changed = Array<number>(6).fill(0);
      for (let i = 0; i < 1536 * 6; i++) {
        if (control.pcm.readInt16LE(i * 2) !== actual.pcm.readInt16LE(i * 2)) changed[i % 6]!++;
      }
      assert.ok(changed[channel]! > 0);
      assert.ok(changed.every((count, c) => c === channel || count === 0));
    });
  }
}
for (const [options, equivalent] of [
  ["allx=-1:ally=-0.5", ""], ["flx=default:fry=1/2", ""],
  ["flx=min", "flx=0.06"], ["ally=max", "ally=15"],
  ["slx=2:sry=2:bcx=2", ""]
]) {
  it(`accepts spread expressions and inactive options: ${options}`, async () => {
    const expected = await run(equivalent!);
    const actual = await run(options!);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.deepEqual(actual.pcm, expected.pcm);
  });
}
for (const [options, code] of [
  ["flx=0.059", 222], ["fry=15.01", 222], ["allx=-1.01", 222], ["ally=15.01", 222],
  ["flx=foo", 234], ["ally=foo", 234], ["lfex=2", 8]
] as const) {
  it(`rejects invalid spread ${options} before emitting PCM`, async () => {
    const actual = await run(options);
    assert.equal(actual.result.exitCode, code, actual.stderr);
    assert.ok(actual.stderr.includes("surround"));
    assert.equal(actual.pcm.length, 0);
  });
}
