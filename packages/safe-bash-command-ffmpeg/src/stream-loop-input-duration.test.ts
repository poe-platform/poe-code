import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const loop of [0, 1, 2]) {
    for (const duration of [undefined, 0.05, 0.125]) {
      it(`${sync ? "sync" : "async"} input -t ${duration} caps the full timeline with -stream_loop ${loop}`, async () => {
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from({ length: 700 }, (_, i) => i / 32768)] }));
        const args = ["-v", "error", "-y", "-stream_loop", String(loop),
          ...(duration === undefined ? [] : ["-t", String(duration)]),
          "-i", "/in.wav", "-f", "s16le", "/out.raw"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
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
        const bytes = volume.readFileSync("/out.raw") as Buffer;
        const count = Math.min(700 * (loop + 1), duration === undefined ? Infinity : duration * 8000);
        assert.equal(bytes.length, count * 2);
        assert.deepEqual(Array.from({ length: count }, (_, i) => bytes.readInt16LE(i * 2)),
          Array.from({ length: count }, (_, i) => i % 700));
      });
    }
  }
}
