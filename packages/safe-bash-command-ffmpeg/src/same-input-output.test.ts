import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const sameOutput of [false, true]) {
    it(`${sync ? "sync" : "async"} protects input audio with same output=${sameOutput} and -y`, async () => {
      const original = encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 800 }, (_, i) => (i - 400) / 32768)] });
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", original);
      const output = sameOutput ? "/in.wav" : "/a.wav";
      const args = ["-v", "error", "-y", "-i", "/in.wav",
        ...(sync ? ["-c", "copy"] : ["-af", "volume=0"]), output];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), sameOutput ? undefined : "");
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
        assert.equal(result.exitCode, sameOutput ? 1 : 0, stderr);
        if (sameOutput) assert.ok(stderr.includes("same as Input #0"), stderr);
      }
      assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(original));
      assert.equal(volume.existsSync("/a.wav"), !sameOutput);
      if (!sameOutput) {
        const samples = parseWav(volume.readFileSync(output) as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
        assert.equal(samples.length, 800);
        assert.deepEqual(Array.from(samples), Array.from({ length: 800 }, (_, i) => sync ? (i - 400) / 32768 : 0));
      }
    });
  }
}
