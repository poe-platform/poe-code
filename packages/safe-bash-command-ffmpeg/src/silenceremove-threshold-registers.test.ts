import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [0, 0, 0, 5000, 4000, -4000, -5000, 0, 0, 0, 0, 8000, -8000, 9000, -7000, 0, 0, 0, 0, 0, 0, 1000, 0, 0];
const repeated = [...samples.slice(0, 7), ...samples.slice(11, 15)];

async function run(command: ReturnType<typeof createFfmpegCommand>, filter: string, graph: boolean) {
  const input = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
  const volume = Volume.fromJSON({ "/in.pcm": input, "/out.pcm": "KEEP" });
  let stderr = "";
  const result = await command.execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.pcm",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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

// Native FFmpeg 7.0.2 PCM: each threshold evaluation starts with zeroed registers.
for (const graph of [false, true]) {
  for (const [filter, expected] of [
    ["silenceremove=start_periods=1:window=0:start_threshold=0.06", samples.slice(3)],
    ["silenceremove=start_periods=1:window=0:start_threshold='st(0,0.06);ld(0)'", samples.slice(3)],
    ["silenceremove=stop_periods=1:window=0:stop_threshold='st(0,0.06);ld(0)'", samples.slice(0, 7)],
    ["silenceremove=1:0:'st(0,0.06);ld(0)':window=0", samples.slice(3)],
    ["silenceremove=start_periods=1:window=0:start_threshold='st(0,1)':start_threshold='ld(0)+0.06'", samples.slice(3)],
    ["silenceremove=stop_periods=-1:window=0:start_threshold='st(0,1)':stop_threshold='ld(0)+0.06':enable='eq(ld(0),0)'", repeated]
  ] as const) {
    it(`evaluates silenceremove threshold registers: ${filter} (graph=${graph})`, async () => {
      const command = createFfmpegCommand();
      for (let execution = 0; execution < 2; execution++) {
        const actual = await run(command, filter, graph);
        assert.equal(actual.exitCode, 0, actual.stderr);
        assert.equal(actual.stderr, "");
        assert.deepEqual(Array.from({ length: actual.output.length / 2 }, (_, i) => actual.output.readInt16LE(i * 2)), expected);
      }
    });
  }

  for (const phase of ["start", "stop"]) {
    for (const [expression, status] of [["st(0)", 234], ["ld(0,1)", 234],
      ["st(0,-1);ld(0)", 222], ["st(0,1/0);ld(0)", 222]] as const) {
      it(`rejects invalid ${phase}_threshold=${expression} without replacing output (graph=${graph})`, async () => {
        const actual = await run(createFfmpegCommand(),
          `silenceremove=${phase}_periods=1:window=0:${phase}_threshold='${expression}'`, graph);
        assert.equal(actual.exitCode, status, actual.stderr);
        assert.ok(actual.stderr.includes("silenceremove:"), actual.stderr);
        assert.equal(actual.output.toString(), "KEEP");
      });
    }
  }
}
