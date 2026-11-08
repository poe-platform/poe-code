import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, parseMp4Boxes, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const fragmented of [false, true]) {
    for (const writeColr of [false, true]) {
      it(`writes the requested colr box (sync=${sync}, fragmented=${fragmented}, writeColr=${writeColr})`, async () => {
        const base = parseMp4(createSyntheticMp4({ width: 64, height: 48, frameCount: 2, fps: 2, includeAudio: false }));
        const input = serializeMp4({ ...base, tracks: base.tracks.map(track => ({ ...track,
          codecDescriptions: track.codecDescriptions.map(codec => ({ ...codec, sarWidth: 4, sarHeight: 3 }))
        })) });
        const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
        const flags = [fragmented ? "frag_keyframe+empty_moov" : "faststart", ...(writeColr ? ["write_colr"] : [])].join("+");
        const args = ["-y", "-i", "/in.mp4", ...(sync ? [] : ["-map", "0:v"]), "-c", "copy", "-movflags", `+${flags}`, "/out.mp4"];
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
        const track = parseMp4(new Uint8Array(volume.readFileSync("/out.mp4") as Buffer)).tracks[0]!;
        const entry = track.codecDescriptions[0]!.rawStsdEntryBytes!;
        const colr = parseMp4Boxes(entry.subarray(86)).filter(box => box.type === "colr");
        assert.deepEqual(colr.map(box => [box.size, Array.from(box.payload)]), writeColr
          ? [[19, [110, 99, 108, 120, 0, 2, 0, 2, 0, 2, 0]]] : []);
        assert.deepEqual([track.width, track.height, track.codecDescriptions[0]!.sarWidth, track.codecDescriptions[0]!.sarHeight], [64, 48, 4, 3]);
        assert.deepEqual(track.samples.map(sample => sample.data), parseMp4(input).tracks[0]!.samples.map(sample => sample.data));
      });
    }
  }
}
