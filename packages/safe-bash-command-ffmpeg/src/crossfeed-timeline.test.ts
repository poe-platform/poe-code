import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Recreate the 8 kHz stereo PCM16 impulses used for native FFmpeg 7.0.2 references.
const channels = [new Float64Array(1100), new Float64Array(1100)];
for (const i of [0, 510, 512, 1022, 1024]) channels[0]![i] = 15000 / 32768;
for (const i of [3, 515, 1027]) channels[1]![i] = -8000 / 32768;

async function run(filter: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels })), "/out.pcm": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
      : ["-af", filter]), "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); } },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: fs.readFileSync("/out.pcm") as Buffer };
}

for (const graph of [false, true]) {
  for (const [filter, hash] of [
    ["crossfeed=enable='gte(t,0.064)'", "140e1c08191ddd55c72471d96285eca80099f581c4f72cea902ca82e707445aa"],
    ["crossfeed=enable=gte(t\\,0.063)", "140e1c08191ddd55c72471d96285eca80099f581c4f72cea902ca82e707445aa"],
    ["crossfeed=enable='mod(n,2)'", "52c322e0f5854b849b28a6b4e2b52acde771dce65de3ec83eca6b4ce96030268"],
    ["asetpts=PTS+512,crossfeed=enable='gte(t,0.064)'", "4092fe57750ebd52b5a5b82e9a0f890dc4b6a3598543430f28cf864f118ec8c2"],
    ["asetnsamples=n=128:p=0,crossfeed=enable='mod(n,2)'", "575b2d6d3d2c9bf7862e7713b8d825170540a02a301777bf355013435f5f323f"]
  ]) {
    it(`crossfeed matches native timeline PCM: ${filter} (graph ${graph})`, async () => {
      const { result, stderr, output } = await run(filter!, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(output.length, 1100 * 4);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      if (filter === "crossfeed=enable='gte(t,0.064)'") {
        assert.deepEqual([510, 512, 513].map(i => [output.readInt16LE(i * 4), output.readInt16LE(i * 4 + 2)]),
          [[15000, 0], [11839, 1661], [-1678, 1678]]);
      }
    });
  }

  for (const enable of ["0", "0.25", "1", "-1"]) {
    it(`crossfeed enable=${enable} matches constant gating (graph ${graph})`, async () => {
      const expected = await run(Math.abs(Number(enable)) >= 0.5 ? "crossfeed" : "anull", graph);
      const actual = await run(`crossfeed=enable=${enable}`, graph);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.deepEqual(actual.output, expected.output);
    });
  }

  for (const enable of ["", "unknown", "gte(t)", "1+"]) {
    it(`rejects invalid crossfeed enable=${enable} without replacing output (graph ${graph})`, async () => {
      const { result, stderr, output } = await run(`crossfeed=enable=${enable}`, graph);
      assert.notEqual(result.exitCode, 0, stderr);
      assert.ok(stderr.includes("crossfeed"), stderr);
      assert.equal(output.toString(), "KEEP");
    });
  }
}
