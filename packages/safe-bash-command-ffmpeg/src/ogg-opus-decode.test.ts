import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const chained of [false, true]) for (const silent of [false, true]) for (const sync of (silent ? [false] : [false, true])) {
  it(`decodes ${chained ? "chained" : "single"} Ogg Opus to ${silent ? "silent" : "tone"} WAV (${sync ? "sync" : "async"})`, async () => {
    const first = readFileSync(new URL("./fixtures/tone-opus.ogg", import.meta.url));
    const input = chained ? Buffer.concat([first, readFileSync(new URL("./fixtures/tone-opus-880.ogg", import.meta.url))]) : first;
    const volume = Volume.fromJSON({ "/in.ogg": input });
    const args = ["-y", "-v", "error", "-i", "/in.ogg", ...(silent ? ["-af", "volume=0"] : []), "/out.wav"];
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
    const audio = parseWav(new Uint8Array(volume.readFileSync("/out.wav") as Buffer)).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 48000);
    assert.equal(audio.channels, 1);
    const pcm = audio.channelData[0]!;
    assert.equal(pcm.length, chained ? 72000 : 36000);
    if (silent) assert.ok(pcm.every(sample => sample === 0));
    else {
      // Native FFmpeg PCM16 reference from the same input bytes.
      for (const [position, expected] of [[0, 75], [1, 289], [20, 3761], [100, -1956], [1000, 3556], [5000, -3534], [35999, -156]]) {
        assert.ok(Math.abs(pcm[position!]! * 32768 - expected!) <= 1);
      }
      for (const [start, frequency] of (chained ? [[0, 440], [36000, 880]] : [[0, 440]])) {
        let crossings = 0;
        for (let i = start! + 1; i < start! + 36000; i++) if (pcm[i - 1]! <= 0 && pcm[i]! > 0) crossings++;
        assert.ok(Math.abs(crossings - frequency! * 0.75) <= 1);
        assert.ok(Math.max(...pcm.subarray(start, start! + 36000)) > 0.1);
      }
    }
  });
}
