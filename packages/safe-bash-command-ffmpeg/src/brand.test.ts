import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, parseMp4Boxes, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const fragmented of [false, true]) {
    for (const brand of [undefined, "mp42", "abc", "abcde", ""]) {
      it(`writes the requested major brand (sync=${sync}, fragmented=${fragmented}, brand=${brand})`, async () => {
        const base = parseMp4(createSyntheticMp4({ width: 64, height: 48, frameCount: 2, fps: 2, includeAudio: false }));
        const input = serializeMp4({ ...base, tracks: base.tracks.map(track => ({ ...track,
          codecDescriptions: track.codecDescriptions.map(codec => ({ ...codec, sarWidth: 4, sarHeight: 3 }))
        })) });
        const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
        const flags = fragmented ? "frag_keyframe+empty_moov" : "faststart";
        const args = ["-y", "-i", "/in.mp4", ...(sync ? [] : ["-map", "0:v"]), "-c", "copy", "-movflags", `+${flags}`, ...(brand === undefined ? [] : ["-brand", brand]), "/out.mp4"];
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
        const bytes = new Uint8Array(volume.readFileSync("/out.mp4") as Buffer);
        const output = parseMp4(bytes);
        const track = output.tracks[0]!;
        const expected = brand && brand.length >= 4 ? brand.slice(0, 4) : "isom";
        assert.equal(new TextDecoder().decode(parseMp4Boxes(bytes)[0]!.payload.subarray(0, 4)), expected);
        assert.equal(output.majorBrand, expected);
        assert.deepEqual(track.samples.map(({ pts, dts, duration }) => ({ pts, dts, duration })),
          parseMp4(input).tracks[0]!.samples.map(({ pts, dts, duration }) => ({ pts, dts, duration })));
        assert.deepEqual([track.width, track.height, track.codecDescriptions[0]!.sarWidth, track.codecDescriptions[0]!.sarHeight], [64, 48, 4, 3]);
        assert.deepEqual(track.samples.map(sample => sample.data), parseMp4(input).tracks[0]!.samples.map(sample => sample.data));
      });
    }
  }
}
