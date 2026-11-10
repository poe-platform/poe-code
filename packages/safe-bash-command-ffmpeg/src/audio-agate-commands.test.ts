import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, graph = false): Promise<Buffer> {
  const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
  const channels = [
    Float64Array.from({ length: 6400 }, (_, i) => ((i * 131) % 4001 - 2000) * [1, 6, 2, 0][Math.floor(i / 512) % 4]! / 32768),
    Float64Array.from({ length: 6400 }, (_, i) => ((i * 47) % 1801 - 900) * [2, 1, 16, 0][Math.floor(i / 512) % 4]! / 32768)
  ];
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  const output = fs.readFileSync("/out.raw") as Buffer;
  assert.equal(output.length, 25600);
  return output;
}

// Native FFmpeg 7.0.2 hashes for the issue's stereo PCM16 fixture.
for (const [filter, hash] of [
  ["agate=makeup=2", "08478a226e4c8e7190b3fba81c0f038c86ff02952addbb342203ce3a355a7d55"],
  ["asendcmd=c=0 agate makeup 2,agate", "08478a226e4c8e7190b3fba81c0f038c86ff02952addbb342203ce3a355a7d55"],
  ["asendcmd=c=0.256 agate makeup 2,agate", "d85b3082633775f1ecf76f83cbdbc71cd0cf4c9d54588f85363903c77dbc76b7"],
  ["asendcmd=c=0.256 agate@v makeup 2,agate@v", "d85b3082633775f1ecf76f83cbdbc71cd0cf4c9d54588f85363903c77dbc76b7"],
  ["asendcmd=c=0 agate@other makeup 2,agate@v", "080a910cf94a6c0fb40d244fbad9515d2ac1d1d14176886ba64b35076e9c06dc"]
]) for (const graph of [false, true]) it(`timed gate matches native: ${filter} (${graph ? "graph" : "simple"})`, async () => {
  assert.equal(createHash("sha256").update(await run(filter!, graph)).digest("hex"), hash);
});

it("targets only the first matching gate and preserves named routing", async () => {
  assert.deepEqual(await run("asendcmd=c=0 agate makeup 2,agate@a,agate@b"), await run("agate@a=makeup=2,agate@b"));
  assert.deepEqual(await run("asendcmd=c=0 agate@b makeup 2,agate@a,agate@b"), await run("agate@a,agate@b=makeup=2"));
});

it("applies commands on incoming frame boundaries and accepts gain expressions", async () => {
  assert.deepEqual(await run("asetnsamples=n=100:p=0,asendcmd=c=0.001 agate makeup 1+1,agate"),
    await run("asetnsamples=n=100:p=0,asendcmd=c=0.0125 agate makeup 2,agate"));
});

it("retains the previous gain for invalid commands and applies later valid updates", async () => {
  for (const value of ["0", "65", "NaN", "bad"]) {
    assert.deepEqual(await run(`asendcmd=c='0 agate makeup 2;0.256 agate makeup ${value};0.512 agate makeup 3',agate`),
      await run("asendcmd=c='0.512 agate makeup 3',agate=makeup=2"));
  }
});
