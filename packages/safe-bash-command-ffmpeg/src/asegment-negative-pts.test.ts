import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 16 }, (_, i) => i + 1);

async function run(graph: string, channels = 1) {
  const input = Buffer.alloc(samples.length * channels * 2);
  samples.forEach((sample, i) => {
    for (let channel = 0; channel < channels; channel++) {
      input.writeInt16LE(channel === 0 ? sample : -sample, (i * channels + channel) * 2);
    }
  });
  const volume = Volume.fromJSON({});
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", "8000", "-ac", String(channels),
      "-i", "pipe:0", "-filter_complex", graph, "-map", "[out]", "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () { yield input; })(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  const output = Buffer.concat(chunks);
  return { result, stderr, output: Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)) };
}

// Native FFmpeg 7.0.2: negative PTS do not postpone the five-sample cut.
for (const shift of [-8, 0, 2, 8]) {
  for (const framing of ["", "asetnsamples=n=4:p=0,"]) {
    for (const prefix of [true, false]) {
      for (const channels of [1, 2]) {
        it(`cuts asegment timestamps (shift=${shift}, framing=${framing}, prefix=${prefix}, channels=${channels})`, async () => {
          const graph = `[0:a]${framing}asetpts=PTS+${shift},asegment=timestamps=0.000625[a][b];` +
            (prefix ? "[b]anullsink;[a]anull[out]" : "[a]anullsink;[b]anull[out]");
          const { result, stderr, output } = await run(graph, channels);
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
          const cut = shift === 8 ? 0 : shift === 2 && framing ? 4 : 5;
          const expected = prefix ? samples.slice(0, cut) : samples.slice(cut);
          assert.deepEqual(output, expected.flatMap(sample => channels === 1 ? [sample] : [sample, -sample]));
        });
      }
    }
  }
}
