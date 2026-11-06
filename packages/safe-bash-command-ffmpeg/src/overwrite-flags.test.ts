import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const existing of [false, true]) {
    for (const flags of [["-y", "-n"], ["-n", "-y"], ["-y"], ["-n"]]) {
      it(`${sync ? "sync" : "async"} ${flags.join(" ")} with existing output=${existing}`, async () => {
        const volume = Volume.fromJSON({});
        const samples = Array.from({ length: 800 }, (_, i) => (i - 400) / 32768);
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples)] }));
        if (existing) volume.writeFileSync("/out.wav", "preserve me");
        const args = ["-v", "error", ...flags, "-i", "/in.wav", "-c", "copy", "/out.wav"];
        const conflict = flags.length === 2;
        const rejected = conflict || (existing && flags[0] === "-n");
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), rejected ? undefined : "");
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
          assert.equal(result.exitCode, conflict ? 234 : rejected ? 1 : 0, stderr);
          if (conflict) assert.ok(stderr.includes("both -y and -n supplied"), stderr);
        }
        if (rejected) {
          assert.equal(volume.existsSync("/out.wav"), existing);
          if (existing) assert.equal(volume.readFileSync("/out.wav", "utf8"), "preserve me");
        } else {
          const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
          assert.deepEqual(Array.from(audio.channelData[0]!), samples);
        }
      });
    }
  }
}
