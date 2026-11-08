import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [option, value, expected] of [
    ["-aspect", "16:9", [[4, 3], [4, 3]]],
    ["-aspect", "1.7777778", [[4, 3], [4, 3]]],
    ["-aspect:v:1", "1:1", [[1, 1], [3, 4]]],
    ["-aspect:0", "1:1", [[3, 4], [4, 3]]],
    [undefined, undefined, [[1, 1], [4, 3]]]
  ] as const) {
    if (sync && option === "-aspect:v:1") continue;
    it(`copies MP4 aspect ${option} ${value} (sync=${sync})`, async () => {
      const base = parseMp4(createSyntheticMp4({ width: 64, height: 48, frameCount: 2 }));
      const track = base.tracks[0]!;
      const input = serializeMp4({ ...base, tracks: sync ? [track] : [track, { ...track, id: 2, width: 85,
        codecDescriptions: track.codecDescriptions.map(codec => ({ ...codec, sarWidth: 4, sarHeight: 3 })) }] });
      const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
      const args = ["-y", "-i", "/in.mp4", ...(sync ? [] : ["-map", "0:v"]), "-c", "copy", ...(option ? [option, value!] : []), "/out.mp4"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
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
      const output = parseMp4(new Uint8Array(volume.readFileSync("/out.mp4") as Buffer));
      assert.equal(output.tracks.length, sync ? 1 : 2);
      output.tracks.forEach((result, index) => {
        assert.deepEqual([result.codecDescriptions[0]!.width, result.codecDescriptions[0]!.height], [64, 48]);
        assert.deepEqual([result.codecDescriptions[0]!.sarWidth, result.codecDescriptions[0]!.sarHeight], expected[index]);
        assert.deepEqual(result.samples.map(sample => sample.data), parseMp4(input).tracks[index]!.samples.map(sample => sample.data));
      });
    });
  }
}
