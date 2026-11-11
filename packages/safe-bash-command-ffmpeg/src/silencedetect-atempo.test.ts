import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 references for short clips and bounded read-ahead on longer input.
const events = [
  "channel: 1 | silence_start: 0",
  "channel: 0 | silence_start: 0.005",
  "channel: 1 | silence_end: 0.008 | silence_duration: 0.008",
  "channel: 1 | silence_start: 0.018",
  "channel: 0 | silence_end: 0.02 | silence_duration: 0.015",
  "channel: 1 | silence_end: 0.032 | silence_duration: 0.014"
];
for (const graph of [false, true]) {
  for (const [length, tail, limit, bytes, hash, silenceEnd] of [
    [256, "atempo=1.5", 1, 84, "d885493f6ecde64e572c8b1bef876b6f4412a23d08505945c958f7cf8c209522", "0.032 | silence_duration: 0.014"],
    [256, "atempo=1.5", undefined, 1024, "dd11219d516b9c90786c79efc6f0d729d789cedbb8cd1416b28950f7db10998b", "0.032 | silence_duration: 0.014"],
    [256, "anull", 1, 128, "", ""],
    [4096, "atempo=1.5", 1, 84, "d885493f6ecde64e572c8b1bef876b6f4412a23d08505945c958f7cf8c209522", "0.08 | silence_duration: 0.062"],
    [4096, "atempo=1.5", 2, 168, "cea6778498e018da04cd291f2749a9e9358c973fff792672eabe142c30b2ec07", "0.084 | silence_duration: 0.066"],
    [4096, "atempo=0.5", 1, 256, "0bfd9d797dcf117c8bd622b4c49a42e431c96b88a84dba7fbea75804cf440c75", "0.064 | silence_duration: 0.046"],
    [4096, "atempo=2", 1, 64, "12e1bfb798986ad273221d78c839b5868c3bf84fd9268995c78c2d9aefec06fe", "0.096 | silence_duration: 0.078"],
    [4096, "atempo=1.5", 0, 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "0.08 | silence_duration: 0.062"]
  ] as const) {
    it(`silencedetect accounts for ${tail} read-ahead (length=${length}, limit=${limit}, graph=${graph})`, async () => {
      const pcm = Buffer.alloc(length * 4);
      for (let i = 0; i < length; i++) {
        pcm.writeInt16LE(i < 40 || i >= 160 ? 9000 : 0, i * 4);
        pcm.writeInt16LE(i >= 64 && i < 144 ? -7000 : 0, i * 4 + 2);
      }
      const input = encodeWav({ sampleRate: 8000, channels: [0, 1].map(channel =>
        Float64Array.from({ length }, (_, i) => pcm.readInt16LE(i * 4 + channel * 2) / 32768)) });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      const filter = `asetnsamples=n=32:p=0,silencedetect=n=-50dB:d=0.002:m=1,${tail}`;
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-nostats", "-v", "info", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          ...(limit === undefined ? [] : ["-frames:a", String(limit)]), "-f", "s16le", "pipe:1"],
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
      assert.equal(result.exitCode, 0, stderr);
      const output = Buffer.concat(stdout);
      if (tail === "anull") {
        assert.deepEqual(output, pcm.subarray(0, 128));
      } else {
        assert.equal(output.length, bytes);
        assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      }
      assert.deepEqual(stderr.trim().split("\n").filter(line => line.includes("silence_"))
        .map(line => line.slice(line.indexOf("] ") + 2)), tail === "anull" ? [
        events[0], "channel: 1 | silence_end: 0.004 | silence_duration: 0.004"
      ] : [...events.slice(0, -1), `channel: 1 | silence_end: ${silenceEnd}`]);
    });
  }
}
