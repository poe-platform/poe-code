import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const channels of [1, 2, 3]) for (const outputChannels of [undefined, 1, 2, 3]) {
  it(`negotiates IMA WAV channels for ${channels} input channels and ${outputChannels ?? "default"} output`, async () => {
    const input = Buffer.alloc(160 * channels * 2);
    for (let i = 0; i < 160 * channels; i++) input.writeInt16LE((i * 331) % 60001 - 30000, i * 2);
    const volume = Volume.fromJSON({ "/in.pcm": input });
    const args = ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", String(channels),
      "-i", "/in.pcm", "-c:a", "adpcm_ima_wav",
      ...(outputChannels === undefined ? [] : ["-ac", String(outputChannels)]), "/out.wav"];
    if (channels === 3 && outputChannels === undefined) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
      assert.equal(volume.existsSync("/out.wav"), false);
    }
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
    if (outputChannels === 3) {
      assert.equal(result.exitCode, 1);
      assert.match(stderr, /unsupported.*channel/i);
      assert.equal(volume.existsSync("/out.wav"), false);
      return;
    }
    assert.equal(result.exitCode, 0, stderr);
    const output = volume.readFileSync("/out.wav") as Buffer;
    const audio = parseWav(output).tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, outputChannels ?? Math.min(channels, 2));
    if (channels === 3 && outputChannels === undefined) {
      const data = output.indexOf("data") + 8;
      assert.equal(output.readUInt32LE(data - 4), 1024);
      const native = spawnSync("ffmpeg", ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "3",
        "-i", "pipe:0", "-c:a", "adpcm_ima_wav", "-f", "wav", "pipe:1"], { input });
      assert.equal(native.status, 0, native.stderr.toString());
      assert.deepEqual(output.subarray(data), native.stdout.subarray(native.stdout.indexOf("data") + 8));
    }
  });
}
