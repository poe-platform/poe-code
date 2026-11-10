import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [-32768, 16000, -8000, 12000, 4000, 8000, 12000, 4000, 16000, -4000, 12000, -8000, 8000, -12000, 4000, -16000];
const input = encodeWav({ sampleRate: 8000, channels: [0, 1].map(channel =>
  Float64Array.from({ length: 8 }, (_, i) => samples[i * 2 + channel]! / 32768)) });

for (const graph of [false, true]) {
  // Complete native FFmpeg 7.0.2 PCM16 output for the reported eight-frame input.
  for (const target of ["asubboost", "asubboost@fx"]) {
    it(`applies ${target} wet at the scheduled frame (graph=${graph})`, async () => {
      const output = await run(`asetnsamples=n=2:p=0,asendcmd=c='0.0005 ${target} wet 0',${target}`, graph);
      assert.equal(output.toString("hex"), "0080803ec0e0e02ea00f401fe02ea00f00000000000000000000000000000000");
    });
  }

  for (const [filter, gains] of [
    ["asubboost@fx", [1, 1, 1, 1, 1, 1, 1, 1]],
    ["asetnsamples=n=2:p=0,asendcmd=c='0.0005 volume volume 0',volume=1", [1, 1, 1, 1, 0, 0, 0, 0]],
    ["asetnsamples=n=2:p=0,asendcmd=c='0.00051 asubboost wet 0',asubboost", [1, 1, 1, 1, 1, 1, 0, 0]],
    ["asendcmd=c='0.0005 asubboost wet 0',asubboost", [1, 1, 1, 1, 1, 1, 1, 1]],
    ["asetnsamples=n=2:p=0,asendcmd=c='0.0005 asubboost@other wet 0',asubboost@fx", [1, 1, 1, 1, 1, 1, 1, 1]],
    ["asetnsamples=n=2:p=0,asetpts=PTS+8000,asendcmd=commands='1.0005 [enter] asubboost@fx wet 0',asubboost@fx", [1, 1, 1, 1, 0, 0, 0, 0]],
    ["asetnsamples=n=2:p=0,asendcmd=c='0 asubboost wet 0;0.0005 asubboost wet 1/2',asubboost", [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5]],
    ["asetnsamples=n=2:p=0,asendcmd=c='0 asubboost wet 0.5;0.00025 asubboost wet invalid;0.0005 asubboost wet 2;0.00075 asubboost wet -1',asubboost", [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]],
    ["asetnsamples=n=2:p=0,asendcmd=c='0.0005 asubboost wet 0.5',asubboost@first,asubboost@second", [1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5]],
    ["asetnsamples=n=2:p=0,asendcmd=c='0.0005 asubboost@second wet 0.5',asubboost@first,asubboost@second", [1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5]]
  ] as const) {
    it(`${filter} preserves frame timing and targeting (graph=${graph})`, async () => {
      const output = await run(filter, graph);
      const expected = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, i) => expected.writeInt16LE(sample * gains[Math.floor(i / 2)]!, i * 2));
      assert.deepEqual(output, expected);
    });
  }

  it(`preserves subboost history while muted (graph=${graph})`, async () => {
    const audio = encodeWav({ sampleRate: 8000, channels: [0, 1].map(channel =>
      Float64Array.from({ length: 1024 }, (_, i) => Math.sin(i * (channel + 1) / 8) / 4)) });
    const options = "asubboost=decay=0.8:delay=20";
    const expected = await run(options, graph, audio);
    expected.fill(0, 256 * 4, 512 * 4);
    const output = await run(`asetnsamples=n=128:p=0,asendcmd=c='0.032 asubboost wet 0;0.064 asubboost wet 1',${options}`, graph, audio);
    assert.deepEqual(output, expected);
  });
}

async function run(filter: string, graph: boolean, audio = input) {
  const volume = Volume.fromJSON({ "/out": "KEEP" });
  volume.writeFileSync("/in.wav", audio);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return volume.readFileSync("/out") as Buffer;
}
