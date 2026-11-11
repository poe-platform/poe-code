import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: escaped clock durations match the 2ms control.
for (const graph of [false, true]) {
  for (const [options, exitCode] of [
    ["d=2ms", 0],
    [String.raw`d='00\:00\:00.002'`, 0],
    [String.raw`duration='00\:00\:00.002':m=no`, 0],
    [String.raw`0.001:'00\:00\:00.002':no`, 0],
    [String.raw`d='00\:00.002'`, 0],
    [String.raw`d=00\\:00\\:00.002`, 0],
    [String.raw`d=\'00:00:00.002\'`, 0],
    [String.raw`d='00\:60\:00.002'`, 234],
    [String.raw`d='-00\:00\:00.002'`, 222],
    [String.raw`d='25\:00\:00'`, 222]
  ] as const) {
    it(`validates clock duration ${JSON.stringify(options)} and preserves PCM (graph=${graph})`, async () => {
      const samples = [0, 500, 0, 500, 0, 0, 0, 0, 1000, 0, 1000, 0,
        0, 0, 0, 0, 0, 500, 0, 500, 0, 0, 0, 0];
      const pcm = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, index) => pcm.writeInt16LE(sample, index * 2));
      const input = Buffer.concat([
        Buffer.from("524946465400000057415645666d74201000000001000200e8030000a00f0000040010006461746130000000", "hex"),
        pcm
      ]);
      const volume = Volume.fromJSON({ "/in.wav": input });
      const filter = `silencedetect=${options}`;
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, exitCode, stderr);
      assert.deepEqual(volume.readFileSync("/in.wav"), input);
      if (exitCode !== 0) {
        assert.equal(Buffer.concat(stdout).length, 0);
        assert.equal(stderr.trim(), "ffmpeg: silencedetect: invalid duration");
        return;
      }
      assert.deepEqual(Buffer.concat(stdout), pcm);
      assert.deepEqual(stderr.trim().split("\n").map(line => line.startsWith("[silencedetect") ? line.slice(line.indexOf("] ") + 2) : line), [
        "silence_start: 0.002",
        "silence_end: 0.004 | silence_duration: 0.002",
        "silence_start: 0.006",
        "silence_end: 0.008 | silence_duration: 0.002",
        "silence_start: 0.01",
        "silence_end: 0.012 | silence_duration: 0.002"
      ]);
    });
  }
}
