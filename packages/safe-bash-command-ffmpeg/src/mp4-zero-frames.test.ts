import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4 } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const limit of [0, 2, undefined]) {
  it(`copies MP4 video with frame limit ${limit ?? "unset"}`, async () => {
    const input = createSyntheticMp4({ width: 4, height: 4, fps: 5, frameCount: 5, includeAudio: false });
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.mp4", input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.mp4", "-c:v", "copy",
        ...(limit === undefined ? [] : ["-frames:v", String(limit)]), "/out.mp4"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer);
    if (limit === 0) {
      assert.equal(output.tracks.length, 0);
    } else {
      assert.equal(output.tracks.length, 1);
      assert.deepEqual(output.tracks[0]!.samples.map(sample => Array.from(sample.data)),
        parseMp4(input).tracks[0]!.samples.slice(0, limit).map(sample => Array.from(sample.data)));
    }
  });
}
