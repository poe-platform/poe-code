import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { cafAst } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg CAF output from Python wave PCM16 [-32768, -257, 0, 257, 32767],
// mono 8 kHz, with title=Needle and artist=Tester. Native s16le outputs are below.
const fixtures = [
  ["pcm_mulaw", "636166660001000064657363000000000000002040bf400000000000756c617700000000000000010000000100000001000000086368616e000000000000000c006400010000000000000000696e666f0000000000000034000000037469746c65004e6565646c65006172746973740054657374657200656e636f646572004c61766636332e312e3130310064617461ffffffffffffffff000000000067ffe780", "8482fcfe000004017c7d"],
  ["pcm_alaw", "636166660001000064657363000000000000002040bf400000000000616c617700000000000000010000000100000001000000086368616e000000000000000c006400010000000000000000696e666f0000000000000034000000037469746c65004e6565646c65006172746973740054657374657200656e636f646572004c61766636332e312e3130310064617461ffffffffffffffff000000002a45d5c5aa", "0082f8fe08000801007e"]
] as const;

for (const [codec, hex, expected] of fixtures) {
  for (const sync of [false, true]) {
    it(`decodes native CAF ${codec} to reference PCM (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.caf", Buffer.from(hex, "hex"));
      const args = ["-v", "error", "-y", "-i", "/in.caf", "-f", "s16le", "/out.raw"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(expected, "hex"));
    });
  }

  it(`probes native CAF ${codec} and validates its packet layout`, () => {
    const ast = cafAst();
    const bytes = Buffer.from(hex, "hex");
    const probe = ast.probe(bytes);
    assert.equal(probe.streams[0]!.codec_name, codec);
    assert.equal(probe.streams[0]!.sample_rate, "8000");
    assert.equal(probe.streams[0]!.channels, 1);
    const doc = ast.parse(bytes, { decodeAudio: false });
    assert.equal(doc.tracks[0]!.decodedAudio, undefined);
    assert.equal(doc.durationSeconds, 5 / 8000);
    for (const [offset, value] of [[32, 1], [36, 2], [40, 2], [48, 16]] as const) {
      const invalid = Buffer.from(bytes);
      invalid.writeUInt32BE(value, offset);
      assert.throws(() => ast.parse(invalid), /Unsupported CAF audio encoding/);
    }
  });
}
