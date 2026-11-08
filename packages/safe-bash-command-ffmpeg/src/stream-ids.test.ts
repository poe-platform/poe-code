import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [options, ids] of [
  [[], [1, 2]],
  [["-streamid", "0:21", "-streamid", "1:43"], [1, 2]],
  [["-streamid", "0:21", "-streamid", "1:43", "-use_stream_ids_as_track_ids", "0"], [1, 2]],
  [["-streamid", "0:21", "-streamid", "1:43", "-use_stream_ids_as_track_ids", "1"], [21, 43]],
  [["-streamid", "0:21", "-streamid", "0:43", "-use_stream_ids_as_track_ids", "1"], [43, 0]],
  [["-use_stream_ids_as_track_ids", "1"], [0, 0]],
] as const) {
  it(`assigns output MP4 stream IDs after mapping: ${options.join(" ")}`, async () => {
    const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 2 }));
    const first = { ...doc.tracks[0]!, id: 42, language: "eng" };
    const second = { ...first, id: 77, language: "fra", samples: first.samples.map(sample => ({
      ...sample, data: sample.data.map(byte => byte ^ 1)
    })) };
    const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(serializeMp4({ ...doc, tracks: [first, second] })) });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/in.mp4", "-map", "0:1", "-map", "0:0", ...options, "-c", "copy", "/out.mp4",
        "-map", "0:1", "-map", "0:0", "-c", "copy", "/next.mp4"],
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
    for (const [path, expected] of [["/out.mp4", ids], ["/next.mp4", [1, 2]]] as const) {
      const output = parseMp4(volume.readFileSync(path) as Buffer);
      assert.deepEqual(output.tracks.map(track => track.id), expected);
      assert.deepEqual(output.tracks.map(track => track.language), ["fra", "eng"]);
      assert.deepEqual(output.tracks.map(track => track.samples.map(sample => Array.from(sample.data))),
        [second, first].map(track => track.samples.map(sample => Array.from(sample.data))));
    }
  });
}
