import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [directives, title] of [
  ["", undefined],
  ["stream", undefined],
  ["stream\nstream_meta title Narrator", "Narrator"],
  ["stream\nstream_meta title old\nstream_meta title 'Main Narrator'", "Main Narrator"]
] as const) {
  for (const format of ["matroska", "s16le"]) {
    it(`concat preserves stream metadata and PCM: ${directives} (${format})`, async () => {
      const { result, stderr, output } = await run(directives, format);
      assert.equal(result.exitCode, 0, stderr);
      let bytes = output;
      if (format === "matroska") {
        const doc = parseMkv(output);
        assert.equal(doc.tracks.length, 1);
        assert.equal(doc.tracks[0]!.codecDescriptions[0]!.codecName, "pcm_s16le");
        assert.equal(doc.tracks[0]!.metadata?.title, title);
        assert.equal(doc.metadata.title, undefined);
        bytes = Buffer.concat(doc.tracks[0]!.samples.map(sample => sample.data));
      }
      const expected = Buffer.alloc(32000);
      for (let i = 0; i < 16000; i++) expected.writeInt16LE(i < 8000 ? 8192 : -8192, i * 2);
      assert.deepEqual(bytes, expected);
    });
  }
}

for (const directives of ["stream_meta title Narrator", "stream\nstream_meta title", "stream\nstream_meta"]) {
  it(`rejects invalid stream metadata without overwriting: ${directives}`, async () => {
    const { result, output } = await run(directives, "matroska");
    assert.notEqual(result.exitCode, 0);
    assert.equal(output.toString(), "keep");
  });
}

async function run(directives: string, format: string) {
  const volume = Volume.fromJSON({
    "/list.ffconcat": `ffconcat version 1.0\n${directives}\nfile a.wav\nfile b.wav\n`,
    "/out.bin": "keep"
  });
  for (const [name, value] of [["a", 0.25], ["b", -0.25]] as const) {
    volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000, channels: [new Float64Array(8000).fill(value)] }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", "/list.ffconcat", "-c:a", "copy", "-f", format, "/out.bin"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: volume.readFileSync("/out.bin") as Buffer };
}
