import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const stdin of [false, true]) {
  for (const sync of [false, true]) {
    for (const [outputs, counts] of [
      [["-t", "0.025", "/a.wav", "-t", "0.075", "/b.wav"], [200, 600]],
      [["-t", "0.025", "/a.wav", "/b.wav"], [200, 800]],
      [["/a.wav", "-t", "0.025"], [800]],
      [["-af", "volume=0", "-t", "0.025", "/a.wav", "/b.wav"], [200, 800]],
      [["-f", "null", "/dev/null", "/a.wav"], [800]],
    ] as const) {
      it(`${sync ? "sync fallback" : "async"} stdin=${stdin} groups output options: ${outputs.join(" ")}`, async () => {
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from({ length: 800 }, (_, i) => (i - 400) / 32768)] }));
        const args = ["-v", "error", "-y", "-i", stdin ? "pipe:0" : "/in.wav", ...outputs];
        if (sync) {
          assert.equal(evalSyncFfmpeg(stdin ? volume.readFileSync("/in.wav") as Buffer : undefined, args,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
          assert.deepEqual(volume.readdirSync("/"), ["in.wav"], "declining sync must not write partial outputs");
        }
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () { if (stdin) yield volume.readFileSync("/in.wav"); })(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        for (const [index, count] of counts.entries()) {
          const path = index === 0 ? "/a.wav" : "/b.wav";
          assert.ok(volume.existsSync(path), `${path} must exist`);
          const audio = parseWav(volume.readFileSync(path) as Buffer).tracks[0]!.decodedAudio!;
          assert.equal(audio.channelData[0]!.length, count);
          assert.deepEqual(Array.from(audio.channelData[0]!), Array.from({ length: count }, (_, i) =>
            outputs.some(value => value === "volume=0") && index === 0 ? 0 : (i - 400) / 32768));
        }
      });
    }
  }
}
