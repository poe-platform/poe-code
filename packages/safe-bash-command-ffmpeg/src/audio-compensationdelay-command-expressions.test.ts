import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const expression of ["1/2", "1/4+1/4", "max/2", "(max+min)/2", "default+0.5"]) {
    it(`scheduled dry ${expression} matches native PCM at sample 32 (${graph ? "graph" : "simple"})`, async () => {
      const actual = await run(`0.004 compensationdelay@d dry ${expression}`, graph);
      const literal = await run("0.004 compensationdelay@d dry 0.5", graph);
      const unchanged = await run("0.004 compensationdelay@d dry 0", graph);
      assert.deepEqual(actual, literal);
      assert.deepEqual(actual.subarray(0, 32 * 2), unchanged.subarray(0, 32 * 2));
      // Native FFmpeg 7.0.2, mono PCM16 samples 256..383 at 8 kHz.
      assert.deepEqual([0, 1, 22, 23, 31, 32, 33, 55, 64].map(i => actual.readInt16LE(i * 2)),
        [0, 0, 0, 256, 264, 409, 410, 444, 457]);
    });
  }
  for (const invalid of ["unknown", "1/", "1/0", "0/0", "-1/2", "3/2", "0b1", "max+0.1", "min-0.1"]) {
    it(`rejected dry ${invalid} preserves the previous gain and later commands (${graph ? "graph" : "simple"})`, async () => {
      const first = "0.004 compensationdelay@d dry 0.5";
      const last = "0.012 compensationdelay@d dry 0.25";
      assert.deepEqual(await run(`${first};0.008 compensationdelay@d dry ${invalid};${last}`, graph),
        await run(`${first};${last}`, graph));
    });
  }
}

async function run(commands: string, graph: boolean): Promise<Buffer> {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from({ length: 128 }, (_, i) => (256 + i) / 32768)] }));
  const filter = `asetnsamples=32:0,asendcmd=c='${commands}',compensationdelay@d=m=1`;
  const output: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const pcm = Buffer.concat(output);
  assert.equal(pcm.length, 128 * 2);
  return pcm;
}
