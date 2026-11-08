import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const codec of ["a_not_real_decoder", "copy", "pcm_s16le", undefined]) {
    for (const option of ["-c:a", "-acodec", "-codec:a"]) {
      it(`${sync ? "sync" : "async"} input audio decoder ${option} ${codec ?? "default"}`, async () => {
        const volume = Volume.fromJSON({});
        const samples = Float64Array.from({ length: 800 }, (_, i) => (i - 400) / 32768);
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
        const args = ["-v", "error", "-y", ...(codec === undefined ? [] : [option, codec]), "-i", "/in.wav", ...(codec === undefined ? [] : ["-c:a", "pcm_s24le"]), "/out.wav"];
        const valid = codec === undefined || codec === "pcm_s16le";
        let inputReads = 0;
        if (sync) {
          const result = evalSyncFfmpeg(args, undefined,
            path => {
              if (path === "/in.wav") inputReads++;
              return volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined;
            },
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
          assert.equal(result, valid ? "" : undefined);
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { inputReads++; return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, valid ? 0 : 1, stderr);
          if (!valid) assert.ok(stderr.includes("Unknown decoder"), stderr);
        }
        assert.equal(volume.existsSync("/out.wav"), valid);
        assert.equal(inputReads, valid ? 1 : 0);
        if (valid) {
          const track = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!;
          assert.equal(track.codecDescriptions[0]!.codecName, codec === undefined ? "pcm_s16le" : "pcm_s24le");
          const audio = track.decodedAudio!;
          assert.equal(audio.sampleRate, 8000);
          assert.equal(audio.channels, 1);
          assert.deepEqual(Array.from(audio.channelData[0]!), Array.from(samples));
        }
      });
    }
  }
}
