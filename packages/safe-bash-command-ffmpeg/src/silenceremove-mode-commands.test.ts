import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const left = [0, 0, 100, 0, 200, 300, 0, 0, 0, 400, 500, 600, 0, 0, 0, 0, 700, 800, 0, 0];
const right = left.map((_, i) => left[(i + 1) % left.length]!);

async function run(filter: string, complex: boolean) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 1000,
    channels: [left, right].map(channel => Float64Array.from(channel, sample => sample / 32768)) }));
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(complex
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const output = Buffer.concat(chunks);
  return Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2));
}

// Complete interleaved PCM16 output from native FFmpeg 7.0.2, with 4 ms frames.
const cases = [
  { phase: "stop", options: "stop_periods=-1", baseline: [0, 0, 0, 100, 100, 0, 0, 200, 200, 300,
    300, 0, 0, 400, 400, 500, 500, 600, 600, 0, 0, 700, 700, 800, 800, 0],
  expected: [0, 0, 0, 100, 100, 0, 0, 200, 200, 300, 400, 500, 500, 600, 700, 800] },
  { phase: "start", options: "start_periods=1:start_duration=0.004", baseline: [],
    expected: [500, 600, 600, 0, 0, 0, 0, 0, 0, 0, 0, 700, 700, 800, 800, 0, 0, 0, 0, 0] }
];
for (const complex of [false, true]) {
  for (const { phase, options, baseline, expected } of cases) {
    const filter = `silenceremove@s=window=0:${options}:${phase}_mode=all`;
    it(`preserves static ${phase}_mode=all (complex=${complex})`, async () => {
      assert.deepEqual(await run(`asetnsamples=4:0,${filter}`, complex), baseline);
    });
    for (const target of ["silenceremove", "silenceremove@s"]) {
      it(`applies scheduled ${phase}_mode to ${target} (complex=${complex})`, async () => {
        assert.deepEqual(await run(`asetnsamples=4:0,asendcmd=c='0.004 ${target} ${phase}_mode any',${filter}`, complex), expected);
      });
    }
    for (const value of ["0", "0.5", "all-1", "min", "none"]) {
      it(`evaluates scheduled ${phase}_mode=${value} at the next frame (complex=${complex})`, async () => {
        assert.deepEqual(await run(`asetnsamples=4:0,asendcmd=c='0.001 silenceremove@s ${phase}_mode ${value}',${filter}`, complex), expected);
      });
    }
    for (const value of ["invalid", "-1", "1.1", "nan", "inf"]) {
      it(`retains ${phase}_mode after rejected value ${value} (complex=${complex})`, async () => {
        assert.deepEqual(await run(`asetnsamples=4:0,asendcmd=c='0.004 silenceremove@s ${phase}_mode any;0.008 silenceremove@s ${phase}_mode ${value}',${filter}`, complex), expected);
      });
    }
    it(`restores ${phase}_mode=all before the next frame (complex=${complex})`, async () => {
      assert.deepEqual(await run(`asetnsamples=4:0,asendcmd=c='0.001 silenceremove@s ${phase}_mode any;0.003 silenceremove@s ${phase}_mode all',${filter}`, complex), baseline);
    });
    it(`ignores ${phase}_mode commands for another instance (complex=${complex})`, async () => {
      assert.deepEqual(await run(`asetnsamples=4:0,asendcmd=c='0.004 silenceremove@other ${phase}_mode any',${filter}`, complex), baseline);
    });
  }
}

for (const complex of [false, true]) {
  it(`retains scheduled stop modes after start trimming removes frames (complex=${complex})`, async () => {
    const filter = "asetnsamples=4:0,asendcmd=c='0.004 silenceremove@s start_mode any;0.004 silenceremove@s stop_mode any',"
      + "silenceremove@s=window=0:start_periods=1:start_duration=0.004:start_mode=all:stop_periods=-1:stop_mode=all";
    assert.deepEqual(await run(filter, complex), [500, 600, 700, 800]);
  });
}
