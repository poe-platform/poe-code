import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

const input = Float64Array.from({ length: 128 }, (_, i) => (i % 8 === 0 ? 3000 : -800) / 32768);
const tilt = "atilt@tilt=freq=500:slope=0.5";

async function run(filter: string, complex = false, channels = [input]) {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.wav", encodeWav({ sampleRate: 8000, channels }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(complex
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-f", "s16le", "/out.raw"],
    command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  assert.equal(result.exitCode, 0, stderr);
  const output = Buffer.from(await fs.readFile("/out.raw"));
  assert.equal(output.length, input.length * channels.length * 2);
  return output;
}

// Native FFmpeg 7.0.2 PCM16 samples at indices 0, 1, 2, 31, 32, 33.
for (const [command, samples, hash] of [
  ["freq 400", [5241, -2872, -1455, -813, 6392, -2936], "ddbb2faeb2aef96ea09c59145a5a34c3c24fc0ef3a1e66371017982a840bb2ba"],
  ["slope 0", [5241, -2872, -1455, -813, 3247, -676], "d2e6a1b07ccf8c0aded585e5bf8abb4a3403207b085f91679d12d00c3edc9325"],
  ["width 300", [5241, -2872, -1455, -813, 4279, -1147], "5915c810ba2b33921dfb49d741c6c276b7de8bf382272de0b86d38066b104629"],
  ["order 2", [5241, -2872, -1455, -813, 8126, -4821], "edd77642afad7cf6eee31fb56e717c41e6dcb4d66859104a75a9cf872e210d85"],
  ["level 0", [5241, -2872, -1455, -813, 590, 200], "c3520284acf0746bdf014dc6b7bf7f0c86d05d87374296e673ceaac1688ccb27"]
] as const) for (const complex of [false, true]) {
  it(`atilt preserves history for scheduled ${command} (${complex ? "graph" : "simple"})`, async () => {
    const output = await run(`asetnsamples=32:0,asendcmd=c='0.004 atilt@tilt ${command}',${tilt}`, complex);
    assert.deepEqual([0, 1, 2, 31, 32, 33].map(i => output.readInt16LE(i * 2)), samples);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}

it("atilt targets only the first matching filter or the requested named instance", async () => {
  const first = "atilt@first=freq=500:slope=0.5";
  assert.deepEqual(await run(`asendcmd=c='0 atilt level 0.5',${first},${tilt}`),
    await run(`${first}:level=0.5,${tilt}`));
  assert.deepEqual(await run(`asendcmd=c='0 atilt@tilt level 0.5',${first},${tilt}`),
    await run(`${first},${tilt}:level=0.5`));
  assert.deepEqual(await run(`asendcmd=c='0 atilt@missing level 0',${tilt}`), await run(tilt));
});

it("atilt applies expressions at the next incoming frame boundary", async () => {
  assert.deepEqual(await run(`asetnsamples=32:0,asendcmd=c='0.001 atilt@tilt freq 0.4k',${tilt}`),
    await run(`asetnsamples=32:0,asendcmd=c='0.004 atilt@tilt freq 400',${tilt}`));
  assert.deepEqual(await run(`asetnsamples=32:0,asendcmd=c='0.016 atilt@tilt level 0',${tilt}`), await run(tilt));
});

it("atilt keeps independent channel histories across scheduled updates", async () => {
  const graph = `asetnsamples=32:0,asendcmd=c='0.004 atilt@tilt level 0;0.008 atilt@tilt level 0.5',${tilt}`;
  const mono = await run(graph);
  const stereo = await run(graph, true, [input, new Float64Array(input.length)]);
  for (let i = 0; i < input.length; i++) {
    assert.equal(stereo.readInt16LE(i * 4), mono.readInt16LE(i * 2));
    assert.equal(stereo.readInt16LE(i * 4 + 2), 0);
  }
});

it("atilt ignores rejected commands and continues with subsequent valid changes", async () => {
  const expected = await run(`asetnsamples=32:0,asendcmd=c='0.008 atilt@tilt level 0.5',${tilt}`);
  for (const command of ["freq 19", "slope 2", "width 99", "order 31", "level -1", "freq NaN", "level bad", "unknown 1"]) {
    assert.deepEqual(await run(`asetnsamples=32:0,asendcmd=c='0.004 atilt@tilt ${command};0.008 atilt@tilt level 0.5',${tilt}`), expected);
  }
});

// Native FFmpeg hashes also cover inactive stage history and sequential updates.
for (const [commands, hash] of [
  ["0.004 atilt@tilt order 2;0.008 atilt@tilt order 5;0.012 atilt@tilt order 8", "95b8d50cf0b88414face4334b6bfe95aa8cb501134ebd77abd6f799b16046c0b"],
  ["0.004 atilt@tilt order 2.5", "edd77642afad7cf6eee31fb56e717c41e6dcb4d66859104a75a9cf872e210d85"],
  ["0.004 atilt@tilt order 3.5", "abfff9ce797306dcad00cd62f7d6c7f10483ba63c66dcb442d5c4335987c74ff"],
  ["0.004 atilt@tilt freq 400;0.004 atilt@tilt level 0.5;0.008 atilt@tilt slope -0.5", "7946a191a3f23976d0a403ae980064b5f9f0f9d4ad33ec8dbbbc455f3c7a16bc"]
]) {
  it(`atilt matches native for ${commands}`, async () => {
    const output = await run(`asetnsamples=32:0,asendcmd=c='${commands}',${tilt}`);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}
