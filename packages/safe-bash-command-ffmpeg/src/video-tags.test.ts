import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const tag of [undefined, "avc1", "avc3", "hvc1", "zzzz"]) {
    it(`copies MP4 video with tag ${tag ?? "default"} (sync=${sync})`, async () => {
      const input = createSyntheticMp4({ width: 16, height: 16, frameCount: 4 });
      const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input), "/out.mp4": "old" });
      const args = ["-y", "-i", "/in.mp4", "-c:v", "copy", ...(tag ? ["-tag:v", tag] : []), "/out.mp4"];
      const invalid = tag === "hvc1" || tag === "zzzz";
      if (sync) {
        const result = evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        assert.equal(result, invalid ? undefined : "");
        if (invalid) return; // The asynchronous command handles errors after sync fallback.
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
        assert.equal(result.exitCode, invalid ? 183 : 0, stderr);
        if (invalid) {
          assert.match(stderr, /incompatible/);
          assert.equal(volume.statSync("/out.mp4").size, 0);
          return;
        }
      }
      const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks[0]!;
      const original = parseMp4(Buffer.from(input)).tracks[0]!;
      assert.equal(output.codecDescriptions[0]!.formatFourCC, tag ?? "avc1");
      assert.deepEqual(output.samples.map(sample => sample.data), original.samples.map(sample => sample.data));
      assert.deepEqual(output.decodedVideoFrames, original.decodedVideoFrames);
    });
  }
}
