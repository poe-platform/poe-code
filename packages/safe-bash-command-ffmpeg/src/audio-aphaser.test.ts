import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// SHA-256 of decoded PCM from native FFmpeg 9.0.1, 8 kHz stereo, 2048 frames.
// The reported FFmpeg 7.0.2 samples also match the first fixture.
for (const [filter, hash, frames = 2048] of [
  ["aphaser=in_gain=0.5:out_gain=0.8:delay=3:decay=0.4:speed=1", "c51d4f0fbc3d6f80a3308d2bc5ee6b53bb319242a848bdd77c1e0d7e4a1fd8e6"],
  ["aphaser", "cf8795015d15a6eb2e8c5e33f74c04c2dd387d15777112aa3dcf314118782866"],
  ["aphaser=0.5:0.8:3:0.4:1:sinusoidal", "386614d6eaef211b7b5808c30b1cf443fdbd13199b9474362f47839ac3e3fccc"],
  ["aphaser=delay=0.125:decay=0", "8c5a347db2f7ea9a1e7069ec1a5dfbc7395e57f0e5185e2e98e4a73087a877bb"],
  ["aphaser=speed=2:type=t", "8b13bd6dbf5d08ef50c78cc22a747b94f08e21641410bd1a2bcb0866ec237cc0"],
  ["aphaser=speed=2:type=s", "5f7b1062ed774bdd9f5fad2dc5c2d0b8738551cd85261ed467ca58deaf2a1482", 18000]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} matches native PCM and rate (${graph ? "graph" : "simple"})`, async () => {
      const { volume, result, stderr } = await run(filter, graph, frames);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channelData.length, 2);
      assert.equal(audio.channelData[0]!.length, frames);
      const pcm = Buffer.alloc(frames * 4);
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < 2; c++) pcm.writeInt16LE(Math.round(audio.channelData[c]![i]! * 32768), i * 4 + c * 2);
      }
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    });
  }
}

// Native FFmpeg 7.0.2 validation statuses and eight-sample signed 16-bit control.
for (const [filter, exitCode] of [
  ["aphaser=wrong=1", 8],
  ["aphaser=type=garbage", 234],
  ["aphaser=type=42", 222],
  ["aphaser=type=t:enable=0", 176],
  ["aphaser=in_gain=2", 222],
  ["aphaser=out_gain=1e9+1", 222],
  ["aphaser=delay=6", 222],
  ["aphaser=decay=1", 222],
  ["aphaser=speed=0", 222],
  ["aphaser=type=t", 0]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} returns native status ${exitCode} and output bytes (${graph ? "graph" : "simple"})`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from([-12655, 12655, 1, -1, 32767, -32768, 0, 300], value => value / 32768)
      ] }, { bitsPerSample: 16 });
      const { volume, result, stderr } = await run(filter, graph, 8, input);
      assert.equal(result.exitCode, exitCode, stderr);
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"),
        exitCode === 0 ? "5ff1c7088303670172267ee900f7bffc" : "4b454550");
    });
  }
}

// Native FFmpeg 9.0.1, unsigned 8-bit mono WAV to signed 16-bit raw PCM.
for (const [filter, hash] of [
  ["anull", "08bf20a6df02b84d99d1bc9538cf14bbf377d59ffe2e1ccfcf9551ea0eda1c37"],
  ["aphaser", "67affb28a1d1f471790db88a20c5c9eaced712e0dd2fd9085138d88fb29cf930"],
  ["aphaser=out_gain=9", "c8657c597c3a6b81fafa32fc8c703a1713c2cee3162a24edae51ce5fbf1b48e4"]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} negotiates unsigned 8-bit input (${graph ? "graph" : "simple"})`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 12000 }, (_, i) => ((i * 67) % 256 - 128) / 128)
      ] }, { bitsPerSample: 8 });
      const { volume, result, stderr } = await run(filter, graph, 12000, input);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(createHash("sha256").update(volume.readFileSync("/out.raw") as Buffer).digest("hex"), hash);
    });
  }
}

// Native FFmpeg 7.0.2 raw s16le PCM for mixed named and positional options.
for (const [options, named, hex] of [
  ["1:delay=1:0.25", "in_gain=0.25:delay=1", "dbf67c053202e0000718eff160faf8fd"],
  ["1:out_gain=0.5:0.25", "in_gain=0.25:out_gain=0.5", "d3f9b5037b0197003c107ff633fca1fe"]
]) {
  for (const graph of [false, true]) {
    it(`aphaser=${options} assigns mixed options like native (${graph ? "graph" : "simple"})`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from([-12655, 12655, 1, -1, 32767, -32768, 0, 300], value => value / 32768)
      ] }, { bitsPerSample: 16 });
      for (const argument of [options, named]) {
        const { volume, result, stderr } = await run(`aphaser=${argument}`, graph, 8, input);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), hex);
      }
    });
  }
}

// Native FFmpeg 7.0.2 evaluates numeric AVOptions before range checks.
for (const [expression, literal] of [
  ["in_gain=1/2", "in_gain=0.5"],
  ["out_gain=4/5", "out_gain=0.8"],
  ["delay=6/2", "delay=3"],
  ["decay=2/5", "decay=0.4"],
  ["speed=2^0", "speed=1"],
  ["in_gain=500m", "in_gain=0.5"],
  ["in_gain=0x1", "in_gain=1"],
  ["in_gain=sin(PI/2)", "in_gain=1"],
  ["in_gain=E/E", "in_gain=1"],
  ["in_gain=PHI/PHI", "in_gain=1"],
  ["type=1-1", "type=s"],
  ["type=sinusoidal+1", "type=t"],
  ["type=1/2", "type=s"],
  ["type=2/3", "type=t"],
  ["1/2:4/5:6/2:2/5:2^0:s", "0.5:0.8:3:0.4:1:s"]
]) {
  for (const graph of [false, true]) {
    it(`aphaser=${expression} matches its native literal (${graph ? "graph" : "simple"})`, async () => {
      const actual = await run(`aphaser=${expression}`, graph);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      const expected = await run(`aphaser=${literal}`, graph);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      assert.deepEqual(actual.volume.readFileSync("/out.wav"), expected.volume.readFileSync("/out.wav"));
    });
  }
}

for (const key of ["in_gain", "out_gain", "delay", "decay", "speed", "type"]) {
  for (const value of ["0b1", "0o1", "1/", "1junk", "1/0", "0/0", "-1/2", key === "out_gain" ? "1e9+1" : "6/1"]) {
    for (const graph of [false, true]) {
      it(`aphaser=${key}=${value} rejects invalid expressions without replacing output (${graph ? "graph" : "simple"})`, async () => {
        const { volume, result } = await run(`aphaser=${key}=${value}`, graph);
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
      });
    }
  }
}

for (const filter of ["aphaser=delay=0", "aphaser=delay=6", "aphaser=speed=0", "aphaser=decay=1", "aphaser=in_gain=NaN", "aphaser=type=bad", "aphaser=unknown=1"]) {
  it(`${filter} rejects invalid options without replacing output`, async () => {
    const { volume, result } = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

// The reported FFmpeg 7.0.2 x86 conversion returns INT32_MIN on overflow.
// Keep s16 wrapping distinct, even when the requested output format is s32.
for (const bits of [16, 32] as const) {
  for (const outputBits of [16, 32] as const) {
    for (const graph of [false, true]) {
      it(`aphaser preserves ${bits}-bit overflow before ${outputBits}-bit output (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.wav", encodeWav({
          sampleRate: 8000,
          channels: [Float64Array.from([-25000, 25000, -9000, 9000, 0], value => value / 32768)]
        }, { bitsPerSample: bits }));
        let stderr = "";
        const filter = "aphaser=out_gain=9:decay=0";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", `s${outputBits}le`, "/out.raw"],
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
        const output = volume.readFileSync("/out.raw") as Buffer;
        const expected = bits === 32 ? [-32768, -32768, -32400, 32400, 0] : [-24464, 24464, -32400, 32400, 0];
        assert.equal(output.length, expected.length * outputBits / 8);
        assert.deepEqual(expected.map((_, i) => outputBits === 32 ? output.readInt32LE(i * 4) : output.readInt16LE(i * 2)),
          expected.map(value => value * (outputBits === 32 ? 65536 : 1)));
      });
    }
  }
}

// Native FFmpeg 7.0.2 x86, signed 16-bit WAV input and raw PCM output.
for (const [filter, expected] of [
  ["aphaser=out_gain=500000:decay=0", "00000000400dc0f20000000000000087"],
  ["aphaser=out_gain=1000000:decay=0", "00000000801a80e5000000000000000e"],
  ["aphaser=out_gain=1000:decay=0", "90c2703d900170fe70fe00000000c0d4"],
  ["anull", "91ce6f310100ffffff7f008000002c01"]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} matches native s16 conversion at large gains (${graph ? "graph" : "simple"})`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from([-12655, 12655, 1, -1, 32767, -32768, 0, 300], value => value / 32768)
      ] }, { bitsPerSample: 16 });
      const { volume, result, stderr } = await run(filter, graph, 8, input);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
    });
  }
}

async function run(filter: string, graph = false, frames = 2048, input?: Uint8Array) {
  const channels = [
    Float64Array.from({ length: frames }, (_, i) => ((i * 67) % 14000 - 7000) / 32768),
    Float64Array.from({ length: frames }, (_, i) => (6000 - (i * 53) % 12000) / 32768)
  ];
  const volume = Volume.fromJSON({ "/out.wav": "keep", "/out.raw": "KEEP" });
  volume.writeFileSync("/in.wav", input ?? encodeWav({ sampleRate: 8000, channels }));
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 3 } }).execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le",
      ...(input ? ["-f", "s16le", "/out.raw"] : ["/out.wav"])],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { volume, result, stderr };
}
