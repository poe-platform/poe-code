import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const [declaration, error] of [
  ["", undefined],
  ["stream\n", undefined],
  ["stream\nexact_stream_id 0\n", undefined],
  ["stream\nexact_stream_id 1\n", "does not contain any stream"],
  ["exact_stream_id 0\n", "without stream"],
  ["stream\nexact_stream_id\n", "invalid stream id"],
  ["stream\nexact_stream_id nope\n", "invalid stream id"]
] as const) {
  it(`concat PCM stream declaration ${JSON.stringify(declaration)}`, async () => {
    const volume = Volume.fromJSON({
      "/list.ffconcat": `ffconcat version 1.0\n${declaration}file a.wav\nfile b.wav\n`,
      "/out.bin": "keep"
    });
    const expected = Buffer.alloc(32);
    for (const [name, base, offset] of [["a", 1000, 0], ["b", -2000, 16]] as const) {
      volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 8 }, (_, i) => (base + i) / 32768)] }));
      for (let i = 0; i < 8; i++) expected.writeInt16LE(base + i, offset + i * 2);
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", "/list.ffconcat", "-c:a", "copy", "-f", "s16le", "/out.bin"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (error) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(stderr.includes(error), stderr);
      assert.equal(volume.readFileSync("/out.bin", "utf8"), "keep");
    } else {
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readFileSync("/out.bin"), expected);
    }
  });
}
