import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 impulse of 1001 followed by seven zeros.
for (const [sampleRate, filter, expected] of [
  [8000, "anull", [1001, 0, 0, 0, 0, 0, 0, 0]],
  [8000, "aemphasis", [578, 545, -94, 26, -7, -4, 10, -13]],
  [8000, "aemphasis=type=riaa", [432, 786, 420, 299, 341, 282, 306, 269]],
  [8000, "aemphasis=1:1:reproduction:cd", [578, 545, -94, 26, -7, -4, 10, -13]],
  [8000, "aemphasis=type=riaa:", [432, 786, 420, 299, 341, 282, 306, 269]],
  [8000, "aemphasis=level_in=0.5:level_out=0.5:type=cd", [144, 136, -23, 7, -2, -1, 2, -3]],
  [8000, "aemphasis,volume=0.5", [289, 273, -47, 13, -3, -2, 5, -6]],
  [44100, "aemphasis", [356, 337, 70, 144, 27, 53, 18, 12]],
  [44100, "aemphasis=type=riaa", [108, 241, 206, 158, 141, 114, 105, 90]],
  [48000, "aemphasis", [330, 343, 67, 140, 43, 44, 34, 6]],
  [48000, "aemphasis=type=riaa", [94, 222, 198, 151, 138, 111, 102, 89]]
] as const) {
  for (const complex of [false, true]) {
    for (const channelCount of [1, 2]) {
      it(`matches native ${filter} PCM samples (${sampleRate} Hz, ${channelCount} channels, ${complex ? "graph" : "simple"})`, async () => {
        const volume = new Volume();
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate,
          channels: [[1001, 0, 0, 0, 0, 0, 0, 0], [0, 0, -1001, 0, 0, 0, 0, 0]]
            .slice(0, channelCount).map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
        const chunks: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-i", "/in.wav", ...(complex
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const pcm = Buffer.concat(chunks);
        assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)),
          expected.flatMap((sample, i) => channelCount === 1 ? [sample] : [sample, i < 2 ? 0 : 0 - expected[i - 2]!]));
      });
    }
  }
}

// Complete interleaved stereo PCM from native FFmpeg 7.0.2.
for (const [mode, type, expected] of [
  ["production", "cd", [1743, 0, 91, -872, -1211, -45, 575, 606, -345, -288, 135, 173, -5, -68, -71, 3,
    3590, 560, 67, -26, -2316, -307, 1062, 120, -624, -60, 224, 8, 19, 22, -159, -36]],
  ["production", "riaa", [6096, 0, -7724, -3051, 2715, 3866, 364, -1359, -2201, -182, 2886, 1102, -3033, -1444, 2660, 1518,
    9970, 501, -13828, -1214, 4278, 9, 1402, 685, -4789, -1000, 5884, 1062, -6065, -969, 5201, 801]],
  ["reproduction", "cd", [330, 0, 343, -165, 67, -171, 140, -34, 43, -70, 44, -21, 34, -22, 6, -17,
    683, 96, 680, 91, 149, 23, 274, 34, 93, 15, 86, 9, 70, 11, 11, 0]]
] as const) {
  for (const filter of [
    `aemphasis=mode=${mode}:type=${type}`,
    `aemphasis=1:1:${mode === "production" ? 1 : 0}:${type === "cd" ? 4 : 3}`
  ]) {
    for (const complex of [false, true]) {
      it(`matches complete native stereo PCM for ${filter} (${complex ? "graph" : "simple"})`, async () => {
        const input = Buffer.alloc(64);
        input.writeInt16LE(1001, 0);
        input.writeInt16LE(-501, 6);
        input.writeInt16LE(2001, 32);
        input.writeInt16LE(301, 34);
        const volume = Volume.fromJSON({ "/in.raw": input });
        const chunks: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-nostats", "-v", "error", "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const pcm = Buffer.concat(chunks);
        assert.equal(pcm.length, input.length);
        assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)), expected);
      });
    }
  }
}

for (const [filter, expectedHash] of [
  ["aemphasis", "f1f7e2ae983eaf987985d5d216c45b3b8a6f379a9eb4c952e043ab57e68ca70f"],
  ["aemphasis=type=riaa", "4cb7445d5977ca66413eb4614374279e409b5893e12feea3b49506c0986f4bba"]
] as const) {
  it(`preserves ${filter} history across input frames`, async () => {
    const input = Buffer.alloc(10000);
    for (let i = 0; i < 5000; i++) input.writeInt16LE((i * 7919) % 20001 - 10000, i * 2);
    const volume = Volume.fromJSON({ "/in.raw": input });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "44100", "-ac", "1", "-i", "/in.raw",
        "-af", filter, "-f", "s16le", "/out.raw"],
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
    const output = volume.readFileSync("/out.raw");
    assert.equal(output.length, input.length);
    // Hash of every output byte from native FFmpeg 7.0.2 with the same input.
    assert.equal(createHash("sha256").update(output).digest("hex"), expectedHash);
  });
}

for (const [argument, exitCode] of [
  ["threads=-1", 222], ["threads=2147483648", 222], ["threads=invalid", 234],
  ["extra_hw_frames=-2", 222], ["extra_hw_frames=invalid", 234],
  ["thread_type=0.5", 222], ["thread_type=invalid", 234],
  ["level_in=-1", 222], ["level_out=65", 222], ["level_in=invalid", 234],
  ["unknown=1", 8], ["type=invalid", 234],
  ["mode=2", 222], ["type=50fm", 8]
] as const) {
  it(`rejects aemphasis=${argument} without replacing output`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": Buffer.alloc(16), "/out.raw": "existing" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        "-af", `aemphasis=${argument}`, "-f", "s16le", "/out.raw"],
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
    assert.match(stderr, /aemphasis:/);
    assert.equal(volume.readFileSync("/out.raw", "utf8"), "existing");
  });
}

for (const [commands, expected] of [
  ["", [330, 0, 343, -165, 67, -171, 140, -34, 43, -70, 44, -21, 34, -22, 6, -17, 683, 96, 680, 91, 149, 23, 274, 34, 93, 15, 86, 9, 70, 11, 11, 0]],
  ["0.0001 aemphasis level_out 0", [330, 0, 343, -165, 67, -171, 140, -34, 43, -70, 44, -21, 34, -22, 6, -17, ...Array(16).fill(0)]],
  ["0.0001 aemphasis@eq level_out 0;0.00025 aemphasis@eq level_out 1", [330, 0, 343, -165, 67, -171, 140, -34, 43, -70, 44, -21, 34, -22, 6, -17, ...Array(8).fill(0), 93, 15, 86, 9, 70, 11, 11, 0]],
  ["0 aemphasis level_in 0", Array(32).fill(0)],
  ["0.0001 aemphasis level_in 0", [330, 0, 343, -165, 67, -171, 140, -34, 43, -70, 44, -21, 34, -22, 6, -17, 25, -3, -5, -12, 15, 2, -5, -8, 8, 2, -2, -4, 3, 1, 0, -2]],
  ["0 aemphasis level_out 65;0 aemphasis level_in invalid", [330, 0, 343, -165, 67, -171, 140, -34, 43, -70, 44, -21, 34, -22, 6, -17, 683, 96, 680, 91, 149, 23, 274, 34, 93, 15, 86, 9, 70, 11, 11, 0]]
] as const) {
  for (const complex of [false, true]) {
    it(`applies timed aemphasis gains without resetting history: ${commands || "control"} (${complex ? "graph" : "simple"})`, async () => {
      const samples = [1001, 0, 0, -501, ...Array(12).fill(0), 2001, 301, ...Array(14).fill(0)];
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `asetnsamples=n=4:p=0,${commands ? `asendcmd=c='${commands}',` : ""}aemphasis@eq`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
      assert.equal(result.exitCode, 0, stderr);
      const pcm = volume.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)), expected);
    });
  }
}

for (const options of ["", "threads=1", "thread_type=slice", "extra_hw_frames=1",
  "threads=0:thread_type=0:extra_hw_frames=-1", "threads=max:extra_hw_frames=default"]) {
  for (const complex of [false, true]) {
    it(`preserves stereo PCM with aemphasis ${options || "control"} (${complex ? "graph" : "simple"})`, async () => {
      const samples = [1001, 0, 0, -501, ...Array(12).fill(0), 2001, 301, ...Array(14).fill(0)];
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `aemphasis${options ? `=${options}` : ""}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
      assert.equal(result.exitCode, 0, stderr);
      const pcm = volume.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)),
        [330, 0, 343, -165, 67, -171, 140, -34, 43, -70, 44, -21, 34, -22, 6, -17, 683, 96, 680, 91, 149, 23, 274, 34, 93, 15, 86, 9, 70, 11, 11, 0]);
    });
  }
}
