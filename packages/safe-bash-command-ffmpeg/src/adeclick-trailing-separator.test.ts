import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/out.pcm": "keep" });
  fs.writeFileSync("/in.wav", encodeWav({
    sampleRate: 8000,
    channels: [Float64Array.from([-600, -500, 30000, -300], value => value / 32768)]
  }));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
      : ["-af", filter]), "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(p: string) { return fs.readFileSync(p); },
      async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); },
      async stat(p: string) { return fs.statSync(p); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  return { result, output: fs.readFileSync("/out.pcm") as Buffer, error: Buffer.concat(errors).toString() };
}

for (const name of ["adeclick", "adeclip"]) for (const graph of [false, true]) {
  for (const options of ["w=55", "w=55:", "window=55:", "55:", "w=55:o=75:"]) {
    it(`matches native PCM with ${name}=${options} (${graph ? "graph" : "simple"})`, async () => {
      const { result, output, error } = await run(`${name}=${options}`, graph);
      assert.equal(result.exitCode, 0, error);
      // FFmpeg 7.0.2: four mono PCM16 samples at 8000 Hz.
      assert.equal(output.toString("hex"), "fefffdff1101fcff");
    });
  }

  for (const options of ["w=55::", "w=55::o=75", ":w=55", "w=:"]) {
    it(`rejects empty options in ${name}=${options} (${graph ? "graph" : "simple"})`, async () => {
      const { result, output } = await run(`${name}=${options}`, graph);
      assert.notEqual(result.exitCode, 0);
      assert.equal(output.toString(), "keep");
    });
  }
}
