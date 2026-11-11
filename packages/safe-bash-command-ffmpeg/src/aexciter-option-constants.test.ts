import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, graph: boolean) {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 48000, channels: [new Float64Array(128).fill(16000 / 32768)] }));
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
  } as never);
  return { exitCode: result.exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
}

for (const graph of [false, true]) {
  // Native FFmpeg 7.0.2: 128 signed PCM16 samples of 16000 at 48 kHz.
  for (const [option, hash] of [
    ["amount=default", "d051ccfda1e05ec18d3f45726052e49ee98f2d7d77ee0c2e1df506658e7f93da"],
    ["amount=1", "d051ccfda1e05ec18d3f45726052e49ee98f2d7d77ee0c2e1df506658e7f93da"],
    ["drive=max", "7297e84fa9121f4a9e091623825aa2a110ddc0c5e27f09ede515fd25061e8b7b"],
    ["drive=10", "7297e84fa9121f4a9e091623825aa2a110ddc0c5e27f09ede515fd25061e8b7b"]
  ]) {
    it(`aexciter=${option} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
      const actual = await run(`aexciter=${option}`, graph);
      assert.equal(actual.exitCode, 0, actual.stderr);
      assert.equal(actual.stderr, "");
      assert.equal(actual.stdout.length, 256);
      assert.equal(createHash("sha256").update(actual.stdout).digest("hex"), hash);
    });
  }

  for (const [option, min, max, fallback] of [
    ["level_in", 0, 64, 1], ["level_out", 0, 64, 1], ["amount", 0, 64, 1],
    ["drive", 0.1, 10, 8.5], ["blend", -10, 10, 0], ["freq", 2000, 12000, 7500], ["ceil", 9999, 20000, 9999]
  ] as const) {
    it(`aexciter resolves ${option} constants and expressions (${graph ? "graph" : "simple"})`, async () => {
      for (const [expression, literal] of [["min", min], ["max", max], ["default", fallback], ["(min+max)/2", (min + max) / 2]] as const) {
        const expected = await run(`aexciter=${option}=${literal}`, graph);
        assert.equal(expected.exitCode, 0, expected.stderr);
        assert.deepEqual(await run(`aexciter=${option}=${expression}`, graph), expected);
      }
    });
  }

  it(`aexciter keeps declared defaults after reassignment (${graph ? "graph" : "simple"})`, async () => {
    const expected = await run("aexciter", graph);
    assert.equal(expected.exitCode, 0, expected.stderr);
    assert.deepEqual(await run("aexciter=amount=3:amount=default:drive=1:drive=default", graph), expected);
    assert.deepEqual(await run("aexciter=default:default:default:default:default:default:default:0", graph), expected);
    assert.deepEqual(
      await run("asetnsamples=n=32:p=0,asendcmd=c='0 aexciter amount max;0.001 aexciter amount default',aexciter=amount=3", graph),
      await run("asetnsamples=n=32:p=0,asendcmd=c='0 aexciter amount 64;0.001 aexciter amount 1',aexciter=amount=3", graph)
    );
  });

  for (const [option, exitCode] of [["amount=max+1", 222], ["drive=min-1", 222], ["amount=unknown", 234], ["listen=default", 234]] as const) {
    it(`aexciter rejects ${option} (${graph ? "graph" : "simple"})`, async () => {
      const actual = await run(`aexciter=${option}`, graph);
      assert.equal(actual.exitCode, exitCode, actual.stderr);
      assert.equal(actual.stdout.length, 0);
    });
  }
}
