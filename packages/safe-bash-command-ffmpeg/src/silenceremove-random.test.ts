import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, mono PCM16 at 1 kHz, four-sample input frames.
const samples = [0, 0, 0, 5000, 4000, -4000, -5000, 0, 0, 0, 0, 8000, -8000, 9000, -7000, 0, 0, 0, 0, 0, 0, 1000, 0, 0];
const randomOutput = [0, 0, 0, 5000, 4000, -4000, -5000, 0, 0, 0, 8000, -8000, 9000, -7000, 0, 0, 0, 0, 0, 0, 1000, 0, 0];
const trim = "silenceremove@trim=stop_periods=-1:stop_threshold=0.06:window=0";
const input = Buffer.alloc(samples.length * 2);
samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));

async function run(command: ReturnType<typeof createFfmpegCommand>, filter: string, graph: boolean) {
  const volume = Volume.fromJSON({ "/in.pcm": input, "/out.pcm": "KEEP" });
  let stderr = "";
  const chain = `asetnsamples=n=4:p=0,${filter}`;
  const result = await command.execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.pcm", ...(graph
      ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]), "-f", "s16le", "/out.pcm"],
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
  for (const [filter, expected] of [
    [`${trim}:enable=0`, samples],
    [`${trim}:enable=1`, [0, 0, 0, 5000, 4000, -4000, -5000, 8000, -8000, 9000, -7000]],
    [`${trim}:enable=random(0)`, randomOutput],
    [`${trim}:enable='randomi(0,0,1)'`, randomOutput],
    [`asendcmd=c='0 silenceremove@trim enable random(0)',${trim}:enable=0`, randomOutput],
    [`asendcmd=c='0.008 silenceremove@trim enable random(0)',${trim}:enable=random(0)`,
      [0, 0, 0, 5000, 4000, -4000, -5000, 0, 0, 0, 8000, -8000, 9000, -7000, 0, 0, 0, 0, 0, 1000, 0, 0]],
    [`asendcmd=c='0.008 silenceremove@trim enable random(0)+invalid',${trim}:enable=random(0)`, randomOutput],
    [`silenceremove@other=enable=random(0),${trim}:enable=random(0)`, randomOutput],
    [`${trim}:enable='st(0,0);random(0)'`, samples]
  ] as const) {
    it(`silenceremove matches native PCM across executions: ${filter} (graph=${graph})`, async () => {
      const command = createFfmpegCommand();
      for (let repeat = 0; repeat < 2; repeat++) {
        const actual = await run(command, filter, graph);
        assert.equal(actual.exitCode, 0, actual.stderr);
        assert.equal(actual.stderr, "");
        assert.deepEqual(Array.from({ length: actual.output.length / 2 }, (_, i) => actual.output.readInt16LE(i * 2)), expected);
      }
    });
  }

  for (const expression of ["random(0,1)", "randomi(0,1)"]) {
    it(`rejects malformed random gate ${expression} without replacing output (graph=${graph})`, async () => {
      const actual = await run(createFfmpegCommand(), `${trim}:enable='${expression}'`, graph);
      assert.equal(actual.exitCode, 234, actual.stderr);
      assert.ok(actual.stderr.includes("silenceremove enable"), actual.stderr);
      assert.equal(actual.output.toString(), "KEEP");
    });
  }
}
