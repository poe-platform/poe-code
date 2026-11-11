import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: negotiate stereo by speaker identity, not channel count.
for (const complex of [false, true]) {
  for (const existing of [false, true]) {
    for (const [layout, exitCode, pcm] of [
      ["FL+FR", 0, "581b60f070fed0207cca201c8c0ae0e3"],
      ["FR+FL", 234, ""],
      ["FC+LFE", 0, "0c0b0c0b86058605e7e9e7e900000000"],
      ["BL+BR", 234, ""],
      ["DL+DR", 0, "581b60f070fed0207cca201c8c0ae0e3"],
      ["LFE+FC", 234, ""]
    ] as const) {
      it(`stereowiden ${layout}, graph=${complex}, existing output=${existing}`, async () => {
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 16000, channels: [
          Float64Array.from([8000, 4000, -16000, 0], sample => sample / 32768),
          Float64Array.from([-2000, 12000, 3000, -9000], sample => sample / 32768)
        ] }));
        if (existing) volume.writeFileSync("/out.raw", "KEEP");
        const filter = `channelmap=0|1:${layout},stereowiden`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav", ...(complex
            ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, exitCode, stderr);
        assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(pcm, "hex"));
      });
    }
  }
}
