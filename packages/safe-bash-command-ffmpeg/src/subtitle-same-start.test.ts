import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const [name, firstEnd, secondStart, secondEnd] of [
  ["equal-start", 500, 100, 900],
  ["separated", 500, 900, 1300],
  ["zero-duration", 100, 600, 900],
  ["touching", 600, 600, 900]
] as const) {
  for (const sync of [false, true]) {
    it(`${sync ? "sync" : "async"} MP4 muxing preserves ${name} subtitle starts`, async () => {
      const timestamp = (ms: number) => `00:00:${String(Math.floor(ms / 1000)).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
      const volume = Volume.fromJSON({ "/in.srt": `1\n00:00:00,100 --> ${timestamp(firstEnd)}\nA\n\n2\n${timestamp(secondStart)} --> ${timestamp(secondEnd)}\nB\n\n` });
      const args = ["-v", "error", "-y", "-i", "/in.srt", "-c:s", "mov_text", "/out.mp4"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, data) => { volume.writeFileSync(path, data); return true; }), "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const track = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks[0]!;
      assert.equal(track.timescale, 1_000_000);
      assert.deepEqual(track.samples.filter(sample => sample.data.length > 0).map(sample => [
        sample.pts * 1_000_000 / track.timescale,
        sample.duration * 1_000_000 / track.timescale,
        new TextDecoder().decode(sample.data)
      ]), [[100000, firstEnd === 100 ? 0 : Math.max(1, Math.min(firstEnd, secondStart) * 1000 - 100000), "A"], [Math.max(100001, secondStart * 1000), (secondEnd - secondStart) * 1000, "B"]]);
    });
  }
}
