import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [12000, -6000, 0, 1000, -8000, 20000, 7000, -4000, 0, 0, 5000, 15000, -3000, 0, 1000, 1000];
const input = encodeWav({ sampleRate: 8000, channels: [0, 1].map(channel =>
  Float64Array.from(samples.filter((_, index) => index % 2 === channel), value => value / 32768)) });

// Native FFmpeg 7.0.2 statuses: option not found, out of range, invalid argument.
const errors = [["f=400:foo=1", 8], ["f=-10", 222], ["f=400:w=oops", 234], ["f=400:r=unknown", 234]] as const;
for (const graph of [false, true]) {
  for (const name of ["lowpass", "highpass", "bandpass", "bandreject", "equalizer", "bass", "lowshelf", "treble", "highshelf"]) {
    for (const [option, status] of errors) {
      it(`returns native status for ${name}=${option} (graph=${graph})`, async () => {
        const { result, output, stderr } = await run(`${name}=${option}`, graph);
        assert.equal(result.exitCode, status, stderr);
        assert.equal(output.length, 0);
      });
    }
  }
  for (const option of ["f=1000000", "w=-1", "w=100000", "p=0", "p=3", "m=-0.1", "m=1.1", "t=0", "t=6", "b=-1", "b=32769", "r=-2", "r=4"]) {
    it(`returns range status for lowpass=${option} (graph=${graph})`, async () => {
      const { result, output, stderr } = await run(`lowpass=${option}`, graph);
      assert.equal(result.exitCode, 222, stderr);
      assert.equal(output.length, 0);
    });
  }
  for (const [option, status] of errors) {
    it(`preserves existing output for lowpass=${option} (graph=${graph})`, async () => {
      const { result, output, stderr, fs } = await run(`lowpass=${option}`, graph, "/out.raw");
      assert.equal(result.exitCode, status, stderr);
      assert.equal(output.length, 0);
      assert.equal(fs.readFileSync("/out.raw", "utf8"), "KEEP");
    });
  }
  it(`preserves valid lowpass PCM (graph=${graph})`, async () => {
    const { result, output, stderr } = await run("lowpass=f=400", graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)),
      [240, -120, 858, -409, 1265, -239, 1244, 630, 1251, 1379, 1395, 1970, 1517, 2792, 1473, 3417]);
  });
}

async function run(filter: string, graph: boolean, destination = "pipe:1") {
  const fs = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.raw": "KEEP" });
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-hide_banner", "-loglevel", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-c:a", "pcm_s16le", "-f", "s16le", destination],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write(data: Uint8Array) { chunks.push(Buffer.from(data)); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { result, output: Buffer.concat(chunks), stderr, fs };
}
