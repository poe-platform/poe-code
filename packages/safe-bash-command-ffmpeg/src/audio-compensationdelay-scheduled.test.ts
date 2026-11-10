import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: 128 mono PCM16 samples 256..383, 8 kHz.
// asetnsamples=32:0,asendcmd=c='0.004 compensationdelay@d ACTION VALUE',compensationdelay@d=m=1
for (const graph of [false, true]) {
  for (const [action, value, delay, dry, wet, bypass] of [
    ["wet", "0", 23, 0, 0, false],
    ["dry", "0.5", 23, 0.5, 1, false],
    ["m", "0", 0, 0, 1, false],
    ["m", "1/2+1", 46, 0, 1, false],
    ["wet", "1/2", 23, 0, 0.5, false],
    ["cm", "100", 46, 0, 1, false],
    ["temp", "-50", 26, 0, 1, false],
    ["enable", "0", 23, 0, 1, true]
  ] as const) {
    for (const [time, start] of [[0.004, 32], [0.0041, 64]] as const) {
      it(`scheduled ${action} applies at sample ${start} (${graph ? "graph" : "simple"})`, async () => {
        const pcm = await run(`asendcmd=c='${time} compensationdelay@d ${action} ${value}',compensationdelay@d=m=1`, graph);
        assert.deepEqual(pcm, expected(i => i < start ? delayed(i, 23)
          : bypass ? 256 + i : dry * (256 + i) + wet * delayed(i, delay)));
      });
    }
  }

  it(`scheduled millimeters change the delay without losing history (${graph ? "graph" : "simple"})`, async () => {
    assert.deepEqual(await run("asendcmd=c='0.004 compensationdelay@d mm 10',compensationdelay@d=m=1:cm=3", graph),
      expected(i => delayed(i, i < 32 ? 23 : 24)));
  });

  it(`scheduled enable expressions preserve bypassed input history (${graph ? "graph" : "simple"})`, async () => {
    assert.deepEqual(await run("asendcmd=c='0.004 compensationdelay@d enable lt(n,1)+gte(n,3)',compensationdelay@d=m=1", graph),
      expected(i => i >= 32 && i < 96 ? 256 + i : delayed(i, 23)));
  });

  for (const [action, valid, invalid] of [
    ["wet", "1/2", "2"], ["dry", "1/2", "-1"], ["m", "1/2", "101"],
    ["cm", "100", "-1"], ["mm", "10", "11"], ["temp", "-50", "51"], ["enable", "0", "unknown"]
  ]) {
    it(`rejected ${action} updates retain the previous setting (${graph ? "graph" : "simple"})`, async () => {
      const initial = `0.004 compensationdelay@d ${action} ${valid}`;
      const baseline = await run(`asendcmd=c='${initial}',compensationdelay@d=m=1:cm=2`, graph);
      const actual = await run(`asendcmd=c='${initial};0.008 compensationdelay@d ${action} ${invalid};0.012 compensationdelay@d ${action} nonsense',compensationdelay@d=m=1:cm=2`, graph);
      assert.deepEqual(actual, baseline);
    });
  }

  it(`scheduled updates select the named instance (${graph ? "graph" : "simple"})`, async () => {
    assert.deepEqual(await run("asendcmd=c='0.004 compensationdelay@d wet 0',compensationdelay@other,compensationdelay@d=m=1", graph),
      expected(i => i < 32 ? delayed(i, 23) : 0));
    assert.deepEqual(await run("asendcmd=c='0.004 compensationdelay@missing wet 0',compensationdelay@d=m=1", graph),
      expected(i => delayed(i, 23)));
  });
}

function delayed(sample: number, delay: number): number {
  return sample < delay ? 0 : 256 + sample - delay;
}

function expected(sample: (index: number) => number): Buffer {
  const pcm = Buffer.alloc(256);
  for (let i = 0; i < 128; i++) {
    const value = sample(i);
    const lower = Math.floor(value);
    pcm.writeInt16LE(value - lower === 0.5 ? lower + lower % 2 : Math.round(value), i * 2);
  }
  return pcm;
}

async function run(filter: string, graph: boolean): Promise<Buffer> {
  const volume = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels: [
    Float64Array.from({ length: 128 }, (_, i) => (256 + i) / 32768)
  ] })) });
  const chain = `asetnsamples=32:0,${filter}`;
  const output: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]), "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return Buffer.concat(output);
}
