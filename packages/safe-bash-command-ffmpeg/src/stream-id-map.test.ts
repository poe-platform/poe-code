import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const maps of [
  ["0:i:77"], ["0:i:0x4d"], ["0:a:i:77"], ["0:#0x4d"],
  ["0", "-0:i:42"], ["0:i:99?", "0:i:77"], ["0:i:1"]
]) {
  it(`maps container IDs independently of ordinals with ${maps.join(" ")}`, async () => {
    const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 5, frameCount: 5, includeAudio: true }));
    const audio = doc.tracks.find(track => track.type === "audio")!;
    const input = serializeMp4({ ...doc, tracks: [
      { ...audio, id: 42, language: "eng" },
      { ...audio, id: 77, language: "fra", samples: audio.samples.slice(0, 2) }
    ] });
    const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.mp4", ...maps.flatMap(map => ["-map", map]), "-c", "copy", "/out.mp4"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (maps[0] === "0:i:1") {
      assert.equal(result.exitCode, 234);
      assert.match(stderr, /matches no streams/);
      assert.equal(volume.existsSync("/out.mp4"), false);
      return;
    }
    assert.equal(result.exitCode, 0, stderr);
    const tracks = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks;
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0]!.id, 1);
    assert.equal(tracks[0]!.language, "fra");
    assert.deepEqual(tracks[0]!.samples.map(sample => sample.data),
      parseMp4(Buffer.from(input)).tracks[1]!.samples.map(sample => sample.data));
  });
}
