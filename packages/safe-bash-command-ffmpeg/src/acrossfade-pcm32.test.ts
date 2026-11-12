import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete s32le outputs captured from native FFmpeg 7.0.2. Both PCM24 and
// PCM32 decode to S32; their fade must truncate before output encoding rounds.
for (const [options, channels, hash] of [
  ["ns=5", 1, "bbddeda6212bdcaa165e973a11bf8fb4ae32e1ee03906a642551a6605a5fc861"],
  ["ns=5:o=0", 1, "f3d8e619120d9ccc79ec3af9bfcd5d5b8bdc5f1688dd9b62aa78a808791adaf8"],
  ["ns=1", 1, "9dec0bee08f8c6d13a505944ac7b6ce89897608d86b07c85a97169f4ab26093f"],
  ["ns=1:o=0", 1, "0c925530ae054c4347ee012a201972b3db8e36cfb6e2629073438772d243d309"],
  ["ns=5", 2, "6d21b2776bbc47567cb12fb3d4bf96a0ff4df57b105287d1e45a9e59ca9a9380"],
  ["ns=5:o=0", 2, "f5cc843f4c01084873394b8190f124f86de7e35835ec92904a1870d364f58c95"],
  ["ns=1", 2, "06b54cea5c8844b2c560604b105587fdcbcc28d1adec8214aee86aaebc2dfa39"],
  ["ns=1:o=0", 2, "34b3de925dd36631f001ec74ecbe2867c0b32bf4bec4b4a4e6bb8577e97ec594"],
  ["ns=5", 4, "e0f52f503db35d04c7a79e45b60dd4fa749d249c62eeb4c28733feebfd8ea19a"],
  ["ns=5:o=0", 4, "ec04fa4ae7e3352bfefcf2ac29b1cf14c9f29d488711ca7be31e305962b2bf14"],
  ["ns=1", 4, "f85d373858addb4fb2fdaad862c6072f08a9bfbc81135c121cbce820d70b1e01"],
  ["ns=1:o=0", 4, "1cbcfc3779195b78453bd9a99a4ed7949f2864084a680fc7934cdca9fc875c49"]
] as const) {
  for (const bitsPerSample of [24, 32] as const) {
    it(`acrossfade matches native S32 arithmetic (${options}, PCM${bitsPerSample}, ${channels} channels)`, async () => {
      const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
      for (const side of [0, 1]) {
        volume.writeFileSync(`/${side}.wav`, encodeWav({ sampleRate: 8000,
          channels: Array.from({ length: channels }, (_, channel) => Float64Array.from({ length: 16 },
            (_, i) => (3001 + 17 * i + 251 * channel) * (side ? -1 : 1) / 32768))
        }, { bitsPerSample }));
      }
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/0.wav", "-i", "/1.wav", "-filter_complex",
          `[0:a][1:a]acrossfade=${options}[o]`, "-map", "[o]", "-f", "s32le", "/out.pcm"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.pcm") as Buffer;
      const length = options.endsWith("o=0") ? 32 : options === "ns=5" ? 27 : 31;
      assert.equal(output.length, length * channels * 4);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}

// Complete native Linux x86-64 FFmpeg 7.0.2 samples, including untouched tails.
for (const [options, transition] of [
  ["c1=nofade:c2=nofade", [-2147483648, -2147483648, -2147483648, -2147483648]],
  ["c1=qsin:c2=qsin", [1847759065, -2147483648, -2147483648, -1847759065]],
  ["c1=tri:c2=tri", [1500000000, -1500000000, 1500000000, -1500000000]],
  ["c1=nofade:c2=nofade:o=0", [2000000000, -2000000000, 2000000000, -2000000000,
    2000000000, -2000000000, 2000000000, -2000000000]]
] as const) {
  it(`acrossfade matches native loud PCM32 samples (${options})`, async () => {
    const tail = [2000000000, -2000000000, 2000000000, -2000000000];
    const volume = Volume.fromJSON({});
    const wav = encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from([...tail, ...tail], value => value / 2147483648)]
    }, { bitsPerSample: 32 });
    volume.writeFileSync("/a.wav", wav);
    volume.writeFileSync("/b.wav", wav);
    const stdout: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
        `[0:a][1:a]acrossfade=ns=4:${options}[o]`, "-map", "[o]", "-f", "s32le", "pipe:1"],
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
    assert.equal(stderr, "");
    const expected = [...tail, ...transition, ...tail];
    const output = Buffer.concat(stdout);
    assert.equal(output.length, expected.length * 4);
    assert.deepEqual(expected.map((_, index) => output.readInt32LE(index * 4)), expected);
  });
}
