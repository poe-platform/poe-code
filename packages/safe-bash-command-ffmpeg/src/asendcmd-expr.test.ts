import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, four eight-sample frames at 0, 1, 2, and 3 ms.
for (const complex of [false, true]) {
for (const [commands, expected] of [
  ["0.001 [expr] volume@v volume 1+T*1000", [1000, 2000, 3000, 4000]],
  ["0.001-0.003 [expr] volume@v volume 1+TI", [1000, 1000, 1500, 1500]],
  ["0.001-0.003 [expr] volume@v volume N", [1000, 2000, 3000, 3000]],
  ["0.001-0.003 [expr] volume@v volume PTS/8", [1000, 1000, 2000, 2000]],
  ["0.001-0.003 [expr] volume@v volume (TE-TS)*1000", [1000, 2000, 2000, 2000]],
  ["0.0015-0.003 [expr] volume@v volume 1+T*1000", [1000, 1000, 3000, 3000]],
  ["0.0001-0.0009 [expr] volume@v volume 0", [1000, 1000, 1000, 1000]],
  ["0.001-0.001 [expr] volume@v volume 0", [1000, 1000, 1000, 1000]],
  ["0.001 [expr] volume@other volume 0", [1000, 1000, 1000, 1000]],
  ["0.001 [expr] volume volume 1+T*1000", [1000, 2000, 3000, 4000]],
  ["0.001 volume@v volume 2", [1000, 2000, 2000, 2000]],
  ["0.001 [enter] volume@v volume 2", [1000, 2000, 2000, 2000]],
  ["0.001-0.003 [enter] volume@v volume 2", [1000, 2000, 2000, 2000]],
  ["0.002 volume@v volume 0.5;0.001-0.003 [expr] volume@v volume 1+T*1000", [1000, 2000, 500, 500]],
  ["0.001 [expr] volume@v volume 1/0", [1000, 0, 0, 0]],
  ["0.001 [expr] volume@v volume 1/3", [1000, 333, 333, 333]]
] as const) {
  it(`dispatches ${commands} (${complex ? "graph" : "simple"})`, async () => {
    const { result, output, stderr } = await run(`asendcmd=c='${commands}',volume@v=1`, complex);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(output.length, 64);
    for (let i = 0; i < 32; i++) assert.equal(output.readInt16LE(i * 2), expected[Math.floor(i / 8)], `sample ${i}`);
  });
}

}

it("evaluates timestamps at the command filter before downstream timestamp changes", async () => {
  const { result, output, stderr } = await run("asetpts=PTS+8000,asendcmd=commands='1.001-1.003 [expr] volume@v volume 1+(T-TS)*1000',asetpts=PTS-8000,volume@v=1");
  assert.equal(result.exitCode, 0, stderr);
  for (let i = 0; i < 32; i++) assert.equal(output.readInt16LE(i * 2), [1000, 1000, 2000, 2000][Math.floor(i / 8)]);
});

for (const commands of ["0.003-0.001 [expr] volume@v volume 1", "0.001 [expr] volume@v volume unknown", "0.001 [bad] volume@v volume 1", "0.001 [expr] volume@v volume 0/0"]) {
  it(`rejects ${commands} without replacing output`, async () => {
    const { result, output } = await run(`asendcmd=c='${commands}',volume@v=1`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(output.toString(), "keep");
  });
}

it("uses unrounded frame time when evaluating T", async () => {
  const { result, output, stderr } = await run("asendcmd=c='0 [expr] volume@v volume T*10000',volume@v=1", false, 44100);
  assert.equal(result.exitCode, 0, stderr);
  for (let i = 0; i < 32; i++) assert.equal(output.readInt16LE(i * 2), [0, 1814, 3628, 5442][Math.floor(i / 8)]);
});

async function run(filter: string, complex = false, sampleRate = 8000) {
  const fs = Volume.fromJSON({ "/out.raw": "keep" });
  fs.writeFileSync("/tone.wav", encodeWav({ sampleRate, channels: [new Float64Array(32).fill(1000 / 32768)] }));
  const errors: Uint8Array[] = [];
  const graph = `asetnsamples=n=8:p=0,${filter}`;
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/tone.wav", ...(complex ? ["-filter_complex", `[0:a]${graph}[out]`, "-map", "[out]"] : ["-af", graph]), "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  return { result, output: fs.readFileSync("/out.raw") as Buffer, stderr: Buffer.concat(errors).toString() };
}
