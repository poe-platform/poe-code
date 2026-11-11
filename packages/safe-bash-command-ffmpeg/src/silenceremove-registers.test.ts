import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [0, 0, 100, 0, 200, 300, 0, 0, 0, 400, 500, 600, 0, 0, 0, 0, 700, 800, 0, 0];
// Native FFmpeg 7.0.2: the register counter and gte(n,3) both trim from frame four.
const expected = [0, 0, 100, 0, 200, 300, 0, 0, 0, 400, 500, 600, 700, 800];
const counter = "silenceremove=window=0:stop_periods=-1:enable='gte(st(0,ld(0)+1),4)'";

async function run(command: ReturnType<typeof createFfmpegCommand>, filter: string, graph: boolean, channels = 1) {
  const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 1000,
    channels: Array.from({ length: channels }, () => Float64Array.from(samples, value => value / 32768)) }));
  let stderr = "";
  const result = await command.execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.pcm") as Buffer };
}

for (const graph of [false, true]) {
  for (const channels of [1, 2]) {
    it(`retains silenceremove timeline registers per frame and resets each execution (${channels} channels, graph=${graph})`, async () => {
      const command = createFfmpegCommand();
      const control = await run(command,
        "asetnsamples=4:0,silenceremove=window=0:stop_periods=-1:enable='gte(n,3)'", graph, channels);
      assert.equal(control.exitCode, 0, control.stderr);
      assert.deepEqual(Array.from({ length: control.output.length / 2 }, (_, i) => control.output.readInt16LE(i * 2)),
        expected.flatMap(value => Array<number>(channels).fill(value)));
      for (let execution = 0; execution < 2; execution++) {
        const actual = await run(command, `asetnsamples=4:0,${counter}`, graph, channels);
        assert.equal(actual.exitCode, 0, actual.stderr);
        assert.deepEqual(actual.output, control.output);
      }
    });
  }

  it(`keeps silenceremove timeline registers local to each filter (graph=${graph})`, async () => {
    const actual = await run(createFfmpegCommand(),
      `asetnsamples=4:0,silenceremove=enable='st(0,100)',${counter}`, graph);
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.deepEqual(Array.from({ length: actual.output.length / 2 }, (_, i) => actual.output.readInt16LE(i * 2)), expected);
  });

  for (const expression of ["st(0)", "ld(0,1)"]) {
    it(`rejects malformed silenceremove register expression ${expression} without replacing output (graph=${graph})`, async () => {
      const actual = await run(createFfmpegCommand(), `silenceremove=enable='${expression}'`, graph);
      assert.equal(actual.exitCode, 234, actual.stderr);
      assert.ok(actual.stderr.includes("silenceremove enable"), actual.stderr);
      assert.equal(actual.output.toString(), "KEEP");
    });
  }
}
