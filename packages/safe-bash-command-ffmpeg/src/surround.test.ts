import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { surroundAudio } from "./audio-surround.js";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: 8192 stereo PCM16 frames at 16 kHz, shared 90 Hz and
// independent 440/700 Hz tones. References retain every decoded sample.
const input = readFileSync(new URL("./fixtures/surround-input.wav", import.meta.url));
async function run(filter: string, graph = false, source = input) {
  const fs = Volume.fromJSON({ "/out.wav": "keep" });
  fs.writeFileSync("/in.wav", source);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); },
      async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); },
      async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
  } as never);
  return { result, stderr, output: fs.readFileSync("/out.wav") as Buffer };
}

// Generic enable is recognized but surround does not support timeline editing.
for (const [option, exitCode] of [["enable=0", 176], ["enable=1", 176], ["unknown=1", 8]] as const) {
  for (const graph of [false, true]) {
    it(`surround=${option} returns the native option status (${graph ? "graph" : "simple"})`, async () => {
      const { result, stderr, output } = await run(`surround=${option}`, graph);
      assert.equal(result.exitCode, exitCode, stderr);
      assert.ok(stderr.includes("surround"), stderr);
      assert.ok(stderr.includes(option.slice(0, option.indexOf("="))), stderr);
      assert.equal(output.toString(), "keep");
    });
  }
}

for (const [filter, fixture, lfe] of [
  ["surround", "default", true],
  ["surround=chl_out=5.1:win_size=1024", "1024", true],
  ["surround=win_size=1536", "1536", true],
  ["surround=win_size=1024.5", "1024", true],
  ["surround=win_size=min", "1024", true],
  ["surround=win_size=512*2", "1024", true],
  ["surround=chl_out=5.1:win_size=1024:lfe=0", "1024", false]
] as const) for (const graph of [false, true]) {
  it(`${filter} matches native per-speaker PCM (${graph ? "graph" : "simple"})`, async () => {
    const { result, stderr, output } = await run(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(output).tracks[0]!.decodedAudio!;
    const expected = parseWav(readFileSync(new URL(`./fixtures/surround-${fixture}.wav`, import.meta.url))).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 16000);
    assert.equal(audio.channels, 6);
    assert.equal(audio.channelMask, 0x3f);
    for (const [c, channel] of audio.channelData.entries()) {
      assert.equal(channel.length, 8192);
      for (const [i, sample] of channel.entries()) {
        const reference = !lfe && c === 3 ? 0 : expected.channelData[c]![i]!;
        assert.ok(Math.abs(sample - reference) * 32768 <= 1,
          `speaker ${c}, sample ${i}: ${sample * 32768}, expected ${reference * 32768}`);
      }
    }
  });
}

// Native FFmpeg 7.0.2 validates the range before rounding integer AVOptions,
// with exact halves going to even, then configures the transform.
for (const [value, size] of [
  ["1024.4", 1024], ["2047.5", 2048], ["2048.5", 2048],
  ["default", 4096], ["max", 65536], ["65535.5", 65536]
] as const) for (const graph of [false, true]) {
  it(`surround win_size=${value} selects ${size} samples (${graph ? "graph" : "simple"})`, async () => {
    const channels = parseWav(input).tracks[0]!.decodedAudio!.channelData.map(channel => Float64Array.from(channel.subarray(0, 512)));
    const source = Buffer.from(encodeWav({ sampleRate: 16000, channels }));
    const expected = await run(`surround=win_size=${size}`, graph, source);
    const actual = await run(`surround=win_size=${value}`, graph, source);
    assert.equal(expected.result.exitCode, 0, expected.stderr);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.deepEqual(actual.output, expected.output);
  });
}

for (const [speaker, option] of ["fl_out", "fr_out", "fc_out", "lfe_out", "bl_out", "br_out"].entries()) {
  for (const graph of [false, true]) for (const level of [0, 0.5, 1, 2]) {
    it(`surround ${option}=${level} changes only speaker ${speaker} (graph=${graph})`, async () => {
      const control = await run("surround=win_size=1024", graph);
      const actual = await run(`surround=win_size=1024:${option}=${level}`, graph);
      assert.equal(control.result.exitCode, 0, control.stderr);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      const baseline = parseWav(control.output).tracks[0]!.decodedAudio!;
      const audio = parseWav(actual.output).tracks[0]!.decodedAudio!;
      const native = parseWav(readFileSync(new URL("./fixtures/surround-1024.wav", import.meta.url))).tracks[0]!.decodedAudio!;
      assert.equal(audio.channels, 6);
      assert.equal(audio.channelMask, 0x3f);
      audio.channelData.forEach((channel, c) => {
        assert.equal(channel.length, native.channelData[c]!.length);
        if (c !== speaker || level === 1) assert.deepEqual(channel, baseline.channelData[c]);
        if (c === speaker && level === 0) assert.ok(channel.every(sample => sample === 0));
        channel.forEach((sample, i) => {
          const expected = native.channelData[c]![i]! * (c === speaker ? level : 1);
          assert.ok(Math.abs(sample - expected) * 32768 <= 2,
            `speaker ${c}, sample ${i}: ${sample}, expected ${expected}`);
        });
      });
    });
  }
}

for (const option of ["fl_out", "fr_out", "fc_out", "lfe_out", "bl_out", "br_out"]) {
  it(`surround ${option} accepts expressions and AVOption constants`, async () => {
    for (const [value, level] of [["min", 0], ["max", 10], ["default", 1], ["1/2", 0.5]] as const) {
      const actual = await run(`surround=win_size=1024:${option}=${value}`);
      const expected = await run(`surround=win_size=1024:${option}=${level}`);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      assert.deepEqual(actual.output, expected.output);
    }
  });
  for (const [value, exitCode] of [["-0.1", 222], ["10.1", 222], ["bad", 234]] as const) {
    it(`surround rejects ${option}=${value} without replacing output`, async () => {
      const { result, output } = await run(`surround=${option}=${value}`);
      assert.equal(result.exitCode, exitCode);
      assert.equal(output.toString(), "keep");
    });
  }
}

it("disabling LFE preserves the other five channels exactly", async () => {
  const on = await run("surround=win_size=1024");
  const off = await run("surround=win_size=1024:lfe=0");
  assert.equal(on.result.exitCode, 0, on.stderr);
  assert.equal(off.result.exitCode, 0, off.stderr);
  const a = parseWav(on.output).tracks[0]!.decodedAudio!;
  const b = parseWav(off.output).tracks[0]!.decodedAudio!;
  a.channelData.forEach((channel, c) => assert.deepEqual(b.channelData[c], c === 3 ? channel.map(() => 0) : channel));
});

for (const graph of [false, true]) {
  it(`equivalent surround layouts preserve exact PCM (${graph ? "graph" : "simple"})`, async () => {
    const channels = [0, 1].map(c => Float64Array.from({ length: 512 }, (_, i) =>
      (((2 * i + c) * 13129) % 30001 - 15000) / 32768));
    const source = Buffer.from(encodeWav({ sampleRate: 8000, channels }));
    const canonical = await run("surround=win_size=1024:chl_in=stereo:chl_out=5.1", graph, source);
    assert.equal(canonical.result.exitCode, 0, canonical.stderr);
    for (const layout of ["chl_in=FL+FR", "chl_in=0x3", "chl_in=2c", "chl_in=3",
      "chl_out=FL+FR+FC+LFE+BL+BR", "chl_out=0x3f", "chl_out=6c", "chl_out=63",
      "chl_in=0x3:chl_out=0x3f"]) {
      const actual = await run(`surround=win_size=1024:${layout}`, graph, source);
      assert.equal(actual.result.exitCode, 0, `${layout}: ${actual.stderr}`);
      assert.deepEqual(actual.output, canonical.output, layout);
    }
  });
}

for (const [filter, exitCode] of [
  ["surround=chl_in=FR+FL", 1],
  ["surround=chl_in=FC+LFE", 1],
  ["surround=chl_in=0x4", 1],
  ["surround=chl_out=5.1(side)", 1],
  ["surround=chl_out=0x60f", 1],
  ["surround=chl_out=invalid", 1],
  ["surround=win_size=0", 222],
  ["surround=win_size=65537", 222],
  ["surround=win_size=NaN", 234],
  ["surround=win_size=1023.9", 222],
  ["surround=win_size=65536.1", 222],
  ["surround=win_size=1/0", 234],
  ["surround=win_size=bad", 234],
  ["surround=win_size=", 234],
  ["surround=lfe=bad", 1],
  ["surround=chl_out=mono", 1],
  ["surround=unknown=1", 8]
] as const) {
  it(`${filter} fails without replacing output`, async () => {
    const { result, stderr, output } = await run(filter);
    assert.equal(result.exitCode, exitCode);
    assert.ok(stderr.includes("surround"), stderr);
    assert.equal(output.toString(), "keep");
  });
}

for (const filter of ["anull", "channelmap=map=1|0:channel_layout=stereo"]) {
  it(`${filter} preserves the stereo control PCM`, async () => {
    const { result, stderr, output } = await run(filter);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(output).tracks[0]!.decodedAudio!;
    const expected = parseWav(input).tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, 2);
    assert.equal(audio.sampleRate, 16000);
    assert.deepEqual(audio.channelData, filter === "anull" ? expected.channelData : [...expected.channelData].reverse());
  });
}

it("preserves a partial final window and supports a following channelmap", async () => {
  const channels = parseWav(input).tracks[0]!.decodedAudio!.channelData.map(channel => Float64Array.from(channel.subarray(0, 777)));
  const source = Buffer.from(encodeWav({ sampleRate: 16000, channels }));
  const { result, stderr, output } = await run("surround=win_size=1024,channelmap=map=4|5:channel_layout=stereo", false, source);
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(output).tracks[0]!.decodedAudio!;
  const expected = parseWav(readFileSync(new URL("./fixtures/surround-short.wav", import.meta.url))).tracks[0]!.decodedAudio!;
  assert.equal(audio.channels, 2);
  audio.channelData.forEach((channel, c) => {
    assert.equal(channel.length, 777);
    channel.forEach((sample, i) => assert.ok(Math.abs(sample - expected.channelData[c + 4]![i]!) * 32768 <= 1));
  });
});

// FFmpeg 7.0.2 emits hop-sized frames (win_size / 2), including a short final frame.
for (const graph of [false, true]) for (const prefix of ["", "asetnsamples=n=100:p=0,"]) {
  it(`surround keeps all 513 samples in its first output frame (${graph ? "graph" : "simple"}, ${prefix || "input frames"})`, async () => {
    const channels = Array.from({ length: 2 }, (_, c) => Float64Array.from({ length: 513 },
      (_, i) => (((2 * i + c) * 13129) % 30001 - 15000) / 32768));
    const source = Buffer.from(encodeWav({ sampleRate: 8000, channels }));
    const { result, stderr, output } = await run(`${prefix}surround,aselect='eq(n,0)'`, graph, source);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(output).tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, 6);
    assert.equal(audio.channelData[0]!.length, 513);
    const pcm = Buffer.alloc(513 * 6 * 2);
    for (let i = 0; i < 513; i++) for (let c = 0; c < 6; c++) {
      pcm.writeInt16LE(Math.round(audio.channelData[c]![i]! * 32768), (i * 6 + c) * 2);
    }
    assert.equal(createHash("sha256").update(pcm).digest("hex"),
      "cf742433bf7457fca33f03e9bb23df07ca56601d9dda4688fa42be067e9acc26");
  });
}

for (const [filter, size] of [["surround", 2048], ["surround=win_size=1024", 512]] as const) {
  it(`${filter} exposes each output frame and its timestamp after input reframing`, async () => {
    const length = size * 2 + 277;
    const channels = parseWav(input).tracks[0]!.decodedAudio!.channelData
      .map(channel => Float64Array.from(channel.subarray(0, length)));
    const source = Buffer.from(encodeWav({ sampleRate: 16000, channels }));
    const control = await run(filter, false, source);
    assert.equal(control.result.exitCode, 0, control.stderr);
    const expected = parseWav(control.output).tracks[0]!.decodedAudio!;
    for (let n = 0; n < 4; n++) {
      const { result, stderr, output } = await run(
        `asetnsamples=n=100:p=0,asetpts=PTS+16000,${filter},aselect='eq(n,${n})*eq(pts,${16000 + n * size})'`,
        false, source);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(output).tracks[0]!.decodedAudio!;
      assert.equal(audio.channelData[0]!.length, Math.max(0, Math.min(size, length - n * size)));
      audio.channelData.forEach((channel, c) => {
        assert.deepEqual(channel, expected.channelData[c]!.subarray(n * size, Math.min(length, (n + 1) * size)));
      });
    }
  });
}

it("bounds surround workspace and honors cancellation", async () => {
  const channels = [new Float32Array(32), new Float32Array(32)];
  await assert.rejects(surroundAudio(channels, 16000, "surround",
    new MediaBudgetTracker({ maxMemoryBytes: 65536 })), /maxMemoryBytes/);
  await assert.rejects(surroundAudio(channels, 16000, "surround",
    new MediaBudgetTracker(), AbortSignal.abort()));
});

for (const graph of [false, true]) for (const filter of [
  "surround=win_size=1024:chl_out=stereo",
  "surround=stereo:win_size=1024:lfe=0,channelmap=map=FL|FR:channel_layout=stereo",
  "surround=chl_out=0x3:win_size=1024"
]) {
  it(`${filter} renders native stereo PCM (${graph ? "graph" : "simple"})`, async () => {
    const channels = [0, 1].map(c => Float64Array.from({ length: 512 }, (_, i) =>
      (((i * 2 + c) * 13129) % 30001 - 15000) / 32768));
    const source = Buffer.from(encodeWav({ sampleRate: 8000, channels }));
    const { result, stderr, output } = await run(filter, graph, source);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(output).tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, 2);
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channelData[0]!.length, 512);
    const pcm = Buffer.alloc(2048);
    for (let i = 0; i < 512; i++) for (let c = 0; c < 2; c++) {
      pcm.writeInt16LE(Math.round(audio.channelData[c]![i]! * 32768), (i * 2 + c) * 2);
    }
    // Native FFmpeg 7.0.2, including the filter's processing rather than anull.
    assert.equal(createHash("sha256").update(pcm).digest("hex"),
      "84845d9e718a5f0a723c1ebd2d81f5db96aebdfcf6df001ebf72b247176d8129");
  });
}

// FFmpeg 7.0.2 raw PCM references for 512 stereo frames at 8 kHz.
for (const [size, hash] of [
  [1024, "550746aadb7678511bce97d51278657234b327196c68034b132807ede73503d7"],
  [1536, "e9065ddd9d5bae799b3f5f84daaf0aa31edd1c01b71ec41c5cf566a1385ae4d6"]
] as const) it(`renders the native ${size}-sample surround window`, async () => {
  const channels = [0, 1].map(c => Float64Array.from({ length: 512 }, (_, i) =>
    (((i * 2 + c) * 13129) % 30001 - 15000) / 32768));
  const { result, stderr, output } = await run(`surround=win_size=${size}`, false,
    Buffer.from(encodeWav({ sampleRate: 8000, channels })));
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(output).tracks[0]!.decodedAudio!;
  assert.equal(audio.channels, 6);
  assert.equal(audio.channelData[0]!.length, 512);
  const pcm = Buffer.alloc(512 * 6 * 2);
  for (let i = 0; i < 512; i++) for (let c = 0; c < 6; c++) {
    pcm.writeInt16LE(audio.channelData[c]![i]! * 32768, (i * 6 + c) * 2);
  }
  if (size === 1024) assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  else {
    const expected = readFileSync(new URL("./fixtures/surround-1536-short.pcm", import.meta.url));
    assert.equal(createHash("sha256").update(expected).digest("hex"), hash);
    const differences = Array.from({ length: pcm.length / 2 }, (_, i) =>
      Math.abs(pcm.readInt16LE(i * 2) - expected.readInt16LE(i * 2)));
    // Native single-precision FFT roundoff can change PCM by one quantization step.
    assert.ok(differences.every(value => value <= 1));
  }
});

for (const size of [1025, 1026, 1024.6]) for (const graph of [false, true]) {
  it(`rejects unsupported surround window ${size} with native status (graph=${graph})`, async () => {
    const { result, stderr, output } = await run(`surround=win_size=${size}`, graph);
    assert.equal(result.exitCode, 218, stderr);
    assert.ok(stderr.includes("surround"), stderr);
    assert.equal(output.length, 0);
  });
}

it("accounts for non-power-of-two FFT scratch before allocating it", async () => {
  const channels = [new Float32Array(32), new Float32Array(32)];
  const baseBytes = 32 * 6 * 4 + 1536 * (6 * 4 + 6 * 8 + 4);
  await assert.rejects(surroundAudio(channels, 8000, "surround=win_size=1536",
    new MediaBudgetTracker({ maxMemoryBytes: baseBytes })), /maxMemoryBytes/);
  await surroundAudio(channels, 8000, "surround=win_size=1536",
    new MediaBudgetTracker({ maxMemoryBytes: baseBytes + 4 * 4096 * 8 }));
  await assert.rejects(surroundAudio(channels, 8000, "surround=win_size=1536",
    new MediaBudgetTracker(), AbortSignal.abort()));
});
