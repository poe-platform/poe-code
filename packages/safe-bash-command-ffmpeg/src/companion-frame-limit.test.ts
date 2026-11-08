import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg: testsrc2=size=16x16:rate=5:duration=4 and
// sine=frequency=440:sample_rate=16000:duration=4, libx264 -g 1 and AAC.
const input = readFileSync(new URL("./fixtures/frame-limit-av.mp4", import.meta.url));
for (const sync of [false, true]) {
  for (const [limits, counts, duration] of [
    [[], [20, 64], 4],
    [["-frames:v", "2"], [2, 7], 0.4],
    [["-frames:a", "16"], [4, 16], 0.96],
    [["-frames:v", "2", "-frames:a", "16"], [2, 7], 0.4],
    [["-frames:v", "100"], [20, 64], 4],
    [["-frames:v", "0"], [0, 0], 0]
  ] as const) {
    it(`stops companion copy packets for ${limits.join(" ") || "unlimited"} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/in.mp4": input });
      const args = ["-y", "-i", "/in.mp4", ...(sync ? [] : ["-map", "0:v", "-map", "0:a"]), ...limits, "-c", "copy", "/out.mp4"];
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
      const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer);
      const source = parseMp4(input);
      for (const [index, type] of ["video", "audio"].entries()) {
        const samples = output.tracks.find(track => track.type === type)?.samples ?? [];
        assert.equal(samples.length, counts[index], type);
        assert.deepEqual(samples.map(sample => sample.data), source.tracks.find(track => track.type === type)!.samples.slice(0, counts[index]).map(sample => sample.data));
      }
      assert.equal(output.durationSeconds, duration);
    });
  }
}
