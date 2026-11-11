import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [loop, range, count, offset] of [
    [-1, ["-t", "0.25"], 2000, 0],
    [-1, ["-to", "0.25"], 2000, 0],
    [-1, ["-ss", "0.15", "-t", "0.25"], 2000, 1200],
    [-1, ["-ss", "0.15", "-to", "0.4"], 2000, 1200],
    [-1, ["-t", "0.25", "-to", "0.05"], 2000, 0],
    [-1, ["-t", "0.05"], 400, 0],
    [-1, ["-t", "0"], 0, 0],
    [2, ["-t", "0.25"], 2000, 0],
    [1, ["-t", "0.25"], 1600, 0],
    [0, ["-t", "0.25"], 800, 0],
    [-1, [], undefined, 0],
    [-1, ["-t", "1000000000"], undefined, 0]
  ] as const) {
    it(`${sync ? "sync" : "async"} -stream_loop ${loop} ${range.join(" ")}`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 800 }, (_, i) => (i - 400) / 32768)] }));
      const args = ["-v", "error", "-y", "-stream_loop", String(loop), "-i", "/in.wav", ...range, "/out.wav"];
      if (sync) {
        const result = evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        // Decoded PCM output cuts decline sync execution before writing.
        assert.equal(result, undefined);
        assert.equal(volume.existsSync("/out.wav"), false);
      }
      let stderr = "";
      const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 60, maxConcatInputs: 1000 } }).execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, count === undefined ? 1 : 0, stderr);
      assert.equal(volume.existsSync("/out.wav"), count !== undefined);
      if (count !== undefined) {
        const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
        assert.equal(audio.channelData[0]!.length, count);
        assert.deepEqual(Array.from(audio.channelData[0]!),
          Array.from({ length: count }, (_, i) => ((i + offset) % 800 - 400) / 32768));
      }
    });
  }
}
