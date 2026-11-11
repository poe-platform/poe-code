import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const [option, literal] of [
    ["amount=none", "amount=0"], ["amount=all+1", "amount=0"],
    ["mode=none", "mode=0"], ["mode=all+1", "mode=0"],
    ["timing=none", "timing=0"], ["timing=all+1", "timing=0"],
    ["offset_l=none", "offset_l=0"], ["offset_r=all+1", "offset_r=0"],
    ["width=all+2", "width=1"], ["level_in=all+2", "level_in=1"],
    ["level_out=none+1", "level_out=1"], ["hz=all+3", "hz=2"],
    ["timing=ms:ms=all+501", "timing=ms:ms=500"],
    ["timing=bpm:bpm=none+120", "timing=bpm:bpm=120"]
  ]) {
    it(`apulsator ${option} resolves constants before bounds checks (graph=${graph})`, async () => {
      const actual = await run(option!, graph);
      const control = await run(literal!, graph);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.equal(control.result.exitCode, 0, control.stderr);
      assert.deepEqual(actual.pcm, control.pcm);
      if (literal === "amount=0") {
        // Native FFmpeg 7.0.2 bypasses modulation for all eight stereo frames.
        assert.equal(actual.pcm.toString("hex"), "401f30f8".repeat(8));
      }
    });
  }
  for (const option of [
    ...["amount", "mode", "timing", "offset_l", "offset_r", "width", "level_in", "level_out", "hz", "ms", "bpm"].map(key => `${key}=all`),
    ...["level_in", "level_out", "hz", "ms", "bpm"].map(key => `${key}=none`),
    "amount=all+3", "mode=all+6", "timing=all+4"
  ]) {
    for (const output of ["pipe:1", "/out.pcm"]) {
      it(`apulsator ${option} returns a range error without output (graph=${graph}, ${output})`, async () => {
        const actual = await run(option, graph, output);
        assert.equal(actual.result.exitCode, 222, actual.stderr);
        assert.equal(actual.pcm.length, 0);
        assert.equal(actual.saved.toString(), "keep");
      });
    }
  }
}

async function run(options: string, graph: boolean, output = "pipe:1") {
  const volume = Volume.fromJSON({ "/out.pcm": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({
    sampleRate: 8000,
    channels: [new Float64Array(8).fill(8000 / 32768), new Float64Array(8).fill(-2000 / 32768)]
  }, { bitsPerSample: 16 }));
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const filter = `apulsator=${options}`;
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { pcm: Buffer.concat(chunks), saved: volume.readFileSync("/out.pcm"), result, stderr };
}
