import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 evaluates during setup and at each 512-sample frame.
for (const [expression, expected] of [
  ["st(0,ld(0)+0.1)", [2400, 3600, 4800, 6000, 7200, 8400, 9600, 10800]],
  ["st(0,0.25)", Array(8).fill(3000)],
  ["ld(0)", Array(8).fill(0)],
  ["st(9,ld(9)+0.1)+ld(0)", [2400, 3600, 4800, 6000, 7200, 8400, 9600, 10800]],
  ["st(-1,0.25)+ld(0)", Array(8).fill(6000)],
  ["st(20,0.25)+ld(9)", Array(8).fill(6000)],
  ["st(1.9,0.25)+ld(1)", Array(8).fill(6000)],
  ["if(0,st(0,1),0.25)+ld(0)", Array(8).fill(3000)],
  ["ifnot(1,st(0,1),0.25)+ld(0)", Array(8).fill(3000)],
  ["if(1,0.25,st(0,1))+ld(0)", Array(8).fill(3000)],
  ["ifnot(0,0.25,st(0,1))+ld(0)", Array(8).fill(3000)],
  ["0.5", Array(8).fill(6000)]
] as const) {
  it(`retains expression registers for ${expression}`, async () => {
    // Repeated executions must start with fresh registers.
    for (let repeat = 0; repeat < 2; repeat++) {
      const { result, fs, stderr } = await run(`volume='${expression}':eval=frame`);
      assert.equal(result.exitCode, 0, stderr);
      const output = fs.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, 8192);
      for (let i = 0; i < 4096; i++) {
        assert.equal(output.readInt16LE(i * 2), expected[Math.floor(i / 512)], `sample ${i}`);
      }
    }
  });
}

it("keeps registers local to each volume expression", async () => {
  const { result, fs, stderr } = await run("volume='st(0,0.5)':eval=frame,volume='ld(0)':eval=frame");
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(fs.readFileSync("/out.raw"), Buffer.alloc(8192));
});

it("evaluates registers only once in eval=once mode", async () => {
  const { result, fs, stderr } = await run("volume='st(0,ld(0)+0.25)':eval=once");
  assert.equal(result.exitCode, 0, stderr);
  const output = fs.readFileSync("/out.raw") as Buffer;
  for (let i = 0; i < 4096; i++) assert.equal(output.readInt16LE(i * 2), 3000);
});

it("resets registers when a command replaces the expression", async () => {
  const { result, fs, stderr } = await run("asendcmd=c='0.128 volume@v volume ld(0)',volume@v='st(0,0.5)':eval=frame");
  assert.equal(result.exitCode, 0, stderr);
  const output = fs.readFileSync("/out.raw") as Buffer;
  for (let i = 0; i < 4096; i++) assert.equal(output.readInt16LE(i * 2), i < 1024 ? 6000 : 0);
});

for (const expression of ["st(0)", "st(0,1,2)", "ld(0,1)", "st(0,unknown)"]) {
  it(`rejects ${expression} without overwriting output`, async () => {
    const { result, fs } = await run(`volume='${expression}':eval=frame`);
    assert.equal(result.exitCode, 234);
    assert.equal(fs.readFileSync("/out.raw", "utf8"), "keep");
  });
}

async function run(filter: string) {
  const fs = Volume.fromJSON({ "/out.raw": "keep" });
  fs.writeFileSync("/tone.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array(4096).fill(12000 / 32768)] }));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/tone.wav", "-af", filter, "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  return { result, fs, stderr: Buffer.concat(errors).toString() };
}
