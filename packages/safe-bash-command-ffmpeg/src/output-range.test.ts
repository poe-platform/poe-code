import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [range, samples] of [
    [["-to", "0.125"], undefined],
    [["-to", "0.25"], undefined],
    [["-to", "0.5"], 2000],
    [["-t", "0.125"], 1000],
    [["-t", "0.125", "-to", "0.875"], 1000],
    [["-to", "0.875", "-t", "0.125"], 1000],
    [["-t", "0.125", "-to", "0.125"], 1000],
    [["-to", "0.125", "-t", "0.125"], 1000],
    [["-t", "0"], 0],
    [["-to", "0.125", "-t", "0"], 0]
  ] as const) {
    for (const existing of [false, true]) {
      it(`${sync ? "sync" : "async"} output -ss 0.25 ${range.join(" ")} with existing=${existing}`, async () => {
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from({ length: 8000 }, (_, i) => (i - 4000) / 32768)] }));
        const original = Buffer.from("preserve existing output");
        if (existing) volume.writeFileSync("/out.wav", original);
        const args = ["-y", "-v", "error", "-i", "/in.wav", "-ss", "0.25", ...range, "-c:a", "pcm_s16le", "/out.wav"];
        if (sync) {
          const result = evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
          assert.equal(result, samples === undefined ? undefined : "");
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
          assert.equal(result.exitCode, samples === undefined ? 1 : 0, stderr);
          if (samples === undefined) assert.ok(stderr.includes("-to value smaller than -ss; aborting."), stderr);
        }
        if (samples === undefined) {
          if (existing) assert.deepEqual(volume.readFileSync("/out.wav"), original);
          else assert.equal(volume.existsSync("/out.wav"), false);
        } else {
          const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
          assert.equal(audio.channelData[0]!.length, samples);
          assert.deepEqual(Array.from(audio.channelData[0]!),
            Array.from({ length: samples }, (_, i) => (i - 2000) / 32768));
        }
      });
    }
  }
}
