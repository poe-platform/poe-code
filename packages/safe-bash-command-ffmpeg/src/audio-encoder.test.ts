import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const codec of ["a_not_real_encoder", "aac", "mp3", "pcm_s24le", "copy", undefined]) {
    for (const option of ["-c:a", "-acodec", "-codec:a", "-c", "-codec"]) {
      it(`${sync ? "sync" : "async"} audio encoder ${option} ${codec ?? "default"}`, async () => {
        const volume = Volume.fromJSON({});
        const samples = Float64Array.from({ length: 800 }, (_, i) => (i - 400) / 32768);
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
        const args = ["-v", "error", "-y", "-i", "/in.wav", ...(codec === undefined ? [] : [option, codec]), "/out.wav"];
        const valid = codec !== "a_not_real_encoder";
        if (sync) {
          const result = evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
          assert.equal(result, valid ? "" : undefined);
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
          assert.equal(result.exitCode, valid ? 0 : 1, stderr);
          if (!valid) assert.ok(stderr.includes("Unknown encoder"), stderr);
        }
        assert.equal(volume.existsSync("/out.wav"), valid);
        if (valid) {
          const track = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!;
          assert.equal(track.codecDescriptions[0]!.codecName, codec === "pcm_s24le" || codec === "aac" || codec === "mp3" ? codec : "pcm_s16le");
          const audio = track.decodedAudio!;
          assert.equal(audio.sampleRate, 8000);
          assert.equal(audio.channels, 1);
          if (codec === "aac" || codec === "mp3") {
            assert.ok(audio.channelData[0]!.some(value => Math.abs(value) > 0.001));
          } else {
            assert.deepEqual(Array.from(audio.channelData[0]!), Array.from(samples));
          }
        }
      });
    }
  }
}
