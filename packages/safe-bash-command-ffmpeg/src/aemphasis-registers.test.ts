import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, complex: boolean) {
  const volume = Volume.fromJSON({
    "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels: [new Float64Array(12).fill(1000 / 32768)] })),
    "/out.raw": "existing"
  });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(complex
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
  return { ...result, stderr, pcm: volume.readFileSync("/out.raw") as Buffer };
}

for (const complex of [false, true]) {
  const route = complex ? "graph" : "simple";
  for (const gain of ["level_in", "level_out"]) {
    for (const expression of [String.raw`st(0\,0.5)`, "ld(0)+0.5", "'st(9,0.25)+ld(9)'", "'st(0,0.5);ld(0)'"]) {
      it(`evaluates aemphasis ${gain}=${expression} (${route})`, async () => {
        const result = await run(`aemphasis=${gain}=${expression}`, complex);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.pcm.length, 24);
        // Complete native FFmpeg 7.0.2 output for twelve PCM16 samples of 1000.
        assert.deepEqual(Array.from({ length: 12 }, (_, i) => result.pcm.readInt16LE(i * 2)),
          [289, 561, 514, 527, 524, 522, 527, 521, 528, 521, 527, 522]);
      });
    }
    it(`evaluates scheduled aemphasis ${gain} registers (${route})`, async () => {
      const prefix = "asetnsamples=n=4:p=0,asendcmd=c='0.0005 aemphasis ";
      const control = await run(`${prefix}${gain} 0.5',aemphasis`, complex);
      const result = await run(`${prefix}${gain} st(0,0.25)+ld(0)',aemphasis`, complex);
      assert.equal(control.exitCode, 0, control.stderr);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.pcm, control.pcm);
      const unchanged = await run("aemphasis", complex);
      assert.equal(unchanged.exitCode, 0, unchanged.stderr);
      assert.deepEqual(result.pcm.subarray(0, 8), unchanged.pcm.subarray(0, 8));
      assert.notDeepEqual(result.pcm.subarray(8), unchanged.pcm.subarray(8));
    });
  }
  for (const options of ["level_in='st(0,1)':level_out=ld(0)+0.5", "level_out='st(0,1)':level_out=ld(0)+0.5"]) {
    it(`keeps aemphasis option registers independent: ${options} (${route})`, async () => {
      const result = await run(`aemphasis=${options}`, complex);
      const control = await run("aemphasis=level_out=0.5", complex);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(control.exitCode, 0, control.stderr);
      assert.deepEqual(result.pcm, control.pcm);
    });
  }
  for (const [expression, exitCode] of [["'st(0)'", 234], ["'ld(0,1)'", 234], ["'st(0,65)'", 222]] as const) {
    it(`rejects invalid aemphasis register expression ${expression} (${route})`, async () => {
      const result = await run(`aemphasis=level_out=${expression}`, complex);
      assert.equal(result.exitCode, exitCode, result.stderr);
      assert.equal(result.pcm.toString(), "existing");
    });
  }
}
