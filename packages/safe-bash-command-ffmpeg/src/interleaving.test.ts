import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

it("stream-copies two video tracks in physical decode-time order", async () => {
  const doc = parseMp4(createSyntheticMp4({ width: 64, height: 48, frameCount: 2, fps: 2, includeAudio: false }));
  const original = doc.tracks[0]!;
  const tracks = [1, 2].map(id => ({ ...original, id,
    codecDescriptions: original.codecDescriptions.map(codec => ({ ...codec, sarWidth: id === 1 ? 1 : 4, sarHeight: id === 1 ? 1 : 3 }))
  }));
  const input = serializeMp4({ ...doc, tracks });
  const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.mp4", "-map", "0:v", "-c", "copy", "/out.mp4"],
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
  const output = parseMp4(new Uint8Array(volume.readFileSync("/out.mp4") as Buffer));
  const packets = output.tracks.flatMap((track, index) => track.samples.map(sample => ({
    index, time: sample.dts / track.timescale, offset: sample.offset!
  }))).sort((a, b) => a.offset - b.offset);
  assert.deepEqual(packets.map(({ index, time }) => [index, time]), [[0, 0], [1, 0], [0, 0.5], [1, 0.5]]);
  for (const [index, track] of output.tracks.entries()) {
    assert.deepEqual(track.samples.map(sample => sample.data), tracks[index]!.samples.map(sample => sample.data));
    assert.deepEqual([track.width, track.height], [64, 48]);
    assert.deepEqual([track.codecDescriptions[0]!.sarWidth, track.codecDescriptions[0]!.sarHeight], index === 0 ? [1, 1] : [4, 3]);
  }
});
