import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// FFmpeg 7.0.2: mono PCM16 WAV at 8 kHz has 512-sample packets. Output
// stream-copy seeking to 0.25 skips the packet containing source sample 2000.
for (const mode of ["async", "sync", "segment"]) {
  for (const codec of ["copy", "pcm_s16le"]) {
    for (const [seek, first] of [[undefined, 0], ["0.25", 2048], ["0.256", 2048]] as const) {
      it(`${mode} WAV output seek ${seek ?? "none"} with ${codec} preserves the native sample range`, async () => {
        const input = encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from({ length: 24000 }, (_, i) => i / 32768)] });
        const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
        const args = ["-y", "-v", "error", "-i", "/in.wav",
          ...(seek === undefined ? [] : ["-ss", seek]), "-c:a", codec,
          ...(mode === "segment" ? ["-f", "segment", "-segment_time", "1", "-segment_list", "/list.csv", "/part%02d.wav"] : ["/out.wav"])];
        const asyncSeek = codec !== "copy" && seek !== undefined;
        if (mode === "sync") {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), asyncSeek ? undefined : "");
          if (asyncSeek) assert.equal(volume.existsSync("/out.wav"), false);
        }
        if (mode !== "sync" || asyncSeek) {
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
        const names = mode === "segment" ? ["/part00.wav", "/part01.wav", "/part02.wav"] : ["/out.wav"];
        const channels = names.map(name => parseWav(volume.readFileSync(name) as Buffer).tracks[0]!.decodedAudio!.channelData[0]!);
        const start = codec === "copy" ? first : Math.round(Number(seek ?? 0) * 8000);
        assert.equal(channels.reduce((total, channel) => total + channel.length, 0), 24000 - start);
        assert.deepEqual(channels.flatMap(channel => Array.from(channel)),
          Array.from(parseWav(input).tracks[0]!.decodedAudio!.channelData[0]!.slice(start)));
        if (mode === "segment" && codec === "copy") {
          assert.deepEqual(channels.map(channel => channel.length), start === 0 ? [8192, 8192, 7616] : [8192, 8192, 5568]);
          assert.equal(volume.readFileSync("/list.csv", "utf8"),
            seek === "0.25"
              ? "part00.wav,0.000000,1.030000\npart01.wav,1.030000,2.054000\npart02.wav,2.054000,2.750000\n"
              : `part00.wav,0.000000,1.024000\npart01.wav,1.024000,2.048000\npart02.wav,2.048000,${start === 0 ? "3.000000" : "2.744000"}\n`);
        }
      });
    }
  }
}
