import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMkv, parseAvi } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const matroska of [false, true]) {
    for (const filter of [undefined, "null", "h264_mp4toannexb", "null,h264_mp4toannexb"]) {
      it(`AVI H.264 copy: sync=${sync}, matroska=${matroska}, filter=${filter}`, async () => {
        const mp4 = createSyntheticMp4({ width: 16, height: 16, frameCount: 2, fps: 2, includeAudio: false });
        const input = matroska ? serializeMkv(parseMp4(mp4)) : mp4;
        const volume = Volume.fromJSON({ "/in": Buffer.from(input) });
        const args = ["-y", "-v", "error", "-i", "/in", ...(sync ? [] : ["-map", "0:v"]), "-c", "copy", ...(filter ? ["-bsf:v", filter] : []), "/out.avi"];
        const rejects = matroska && (filter === undefined || filter === "null");
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), rejects ? undefined : "");
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
          assert.equal(result.exitCode === 0, !rejects, stderr);
          if (rejects) {
            assert.ok(stderr.includes("h264 bitstream malformed, no startcode found"), stderr);
            assert.ok(stderr.includes("-bsf:v h264_mp4toannexb"), stderr);
          }
        }
        if (rejects) assert.equal(volume.existsSync("/out.avi"), false);
        else {
          const track = parseAvi(volume.readFileSync("/out.avi") as Buffer).tracks[0]!;
          assert.equal(track.codecDescriptions[0]!.codecName, "h264");
          assert.equal(track.samples.length, 2);
        }
      });
    }
  }
}
