import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Exit statuses and PCM bytes verified against FFmpeg 7.0.2.
for (const [filter, exitCode] of [
  ["channelmap", 234],
  ["channelmap=", 234],
  ["channelmap=map=", 234],
  ["channelmap=0|FL", 234],
  ["channelmap=FR-FR|FL", 234],
  ["channelmap=map=1|0:channel_layout=mono", 234],
  ["channelmap=1-0|0-0", 234],
  ["channelmap=channel_layout=stereo", 0]
] as const) {
  for (const complex of [false, true]) {
    for (const output of ["pipe:1", "/absent.raw", "/existing.raw"]) {
      it(`matches native channelmap status and output (${complex ? "graph" : "simple"}, ${output}): ${filter}`, async () => {
        const input = encodeWav({ sampleRate: 8000, channels: [
          Float64Array.from([100, 200, -300, -400], value => value / 32768),
          Float64Array.from([1000, -2000, 3000, -4000], value => value / 32768)
        ] });
        const volume = Volume.fromJSON({ "/pair.wav": Buffer.from(input), "/existing.raw": "keep" });
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/pair.wav",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", output],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, exitCode, stderr);
        const expected = Buffer.from(exitCode === 0 ? "6400e803c80030f8d4feb80b70fe60f0" : "", "hex");
        assert.deepEqual(Buffer.concat(stdout), output === "pipe:1" ? expected : Buffer.alloc(0));
        if (exitCode === 0) {
          assert.equal(stderr, "");
          if (output !== "pipe:1") assert.deepEqual(volume.readFileSync(output), expected);
        } else {
          assert.ok(stderr.startsWith("ffmpeg: channelmap:"), stderr);
          assert.equal(volume.existsSync("/absent.raw"), false);
          assert.equal(volume.readFileSync("/existing.raw", "utf8"), "keep");
        }
        assert.deepEqual(volume.readFileSync("/pair.wav"), Buffer.from(input));
      });
    }
  }
}
