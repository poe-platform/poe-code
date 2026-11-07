import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { mp3Ast, serializeWav, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const codec of ["libmp3lame", "mp3", undefined]) {
    it(`${sync ? "sync" : "async"} WAV to MP3 with ${codec ?? "default encoder"}`, async () => {
      const volume = Volume.fromJSON({});
      const samples = Float64Array.from({ length: 8000 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / 8000));
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
      const args = ["-v", "error", "-y", "-i", "/in.wav", ...(codec ? ["-c:a", codec] : []), "/out.mp3"];
      if (sync) {
        const result = evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        assert.equal(result, "");
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
      const plugin = mp3Ast();
      const bytes = new Uint8Array(volume.readFileSync("/out.mp3") as Buffer);
      const doc = plugin.parse(bytes);
      const audio = parseWav(serializeWav(doc)).tracks[0]!.decodedAudio!;
      assert.equal(audio.channels, 1);
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channelData[0]!.length, samples.length);
      assert.ok(audio.channelData[0]!.some(sample => Math.abs(sample) > 0.1));
      assert.deepEqual(plugin.parse(plugin.serialize(doc, { audioCodec: "copy" })).tracks[0]!.samples,
        doc.tracks[0]!.samples);
    });
  }
}
