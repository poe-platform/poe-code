import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM32 impulse and controls, including float operand rounding.
for (const [filter, hex] of [
  ["aecho=0:1:0.125:0.7", "000000006062e80d"],
  ["aecho=0:1:0.125:1", "000000006043de13"],
  ["anull", "5543de13"]
]) {
  it(`${filter} matches native PCM32 delayed impulse`, async () => {
    const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
    volume.writeFileSync("/deep.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.of(333333333 / 2147483648)]
    }, { bitsPerSample: 32 }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/deep.wav", "-af", filter, "-f", "s32le", "/out.pcm"],
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
    assert.equal((volume.readFileSync("/out.pcm") as Buffer).toString("hex"), hex);
  });
}

// Saturation is predicted from gains, even when these input samples cannot clip.
for (const [filter, level, warning, hex] of [
  ["aecho=1:1:1:1", "warning", true, "803e000000000000c0e0000000000000803e000000000000c0e0000000000000"],
  ["aecho=0.5:0.5:1:0.5", "warning", false, "a00f00000000000030f8000000000000a00f00000000000030f8000000000000"],
  ["aecho=1:1:1:1", "error", false, "803e000000000000c0e0000000000000803e000000000000c0e0000000000000"],
  ["aecho=0.5:1:1:1", "warning", false, "401f00000000000060f0000000000000803e000000000000c0e0000000000000"],
  ["aecho=0.5:1:1:0.5", "warning", false, "401f00000000000060f0000000000000401f00000000000060f0000000000000"],
  ["aecho=in_gain=1:out_gain=1:delays=1:decays=1", "24", true, "803e000000000000c0e0000000000000803e000000000000c0e0000000000000"]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} saturation warning at ${level} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from([16000, 0, 0, 0, -8000, 0, 0, 0], value => value / 32768)
      ] }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", level, "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.pcm"],
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
      assert.equal((volume.readFileSync("/out.pcm") as Buffer).toString("hex"), hex);
      assert.equal(stderr.includes("out_gain 1.000000 can cause saturation of output"), warning, stderr);
      assert.equal(stderr.includes("can cause saturation"), warning, stderr);
    });
  }
}

// Native FFmpeg 7.0.2: 16 stereo frames at 8 kHz, with independent impulses.
for (const [filter, frames, left, right] of [
  ["anull", 16, [[0, 12000]], [[2, -8000]]],
  ["aecho=0.5:1:1|2:0.5|0.25", 32, [[0, 6000], [8, 6000], [16, 3000]], [[2, -4000], [10, -4000], [18, -2000]]],
  ["aecho=in_gain=0.5:out_gain=1:delays=1|2:decays=0.5|0.25", 32, [[0, 6000], [8, 6000], [16, 3000]], [[2, -4000], [10, -4000], [18, -2000]]],
  ["aecho=0.5:1:1:0.5", 24, [[0, 6000], [8, 6000]], [[2, -4000], [10, -4000]]],
  ["aecho=0.5:1:0.2:0.5", 17, [[0, 6000], [1, 6000]], [[2, -4000], [3, -4000]]],
  ["aecho=0.5:1:0.01|2:0.5|0.25", 32, [[0, 6000], [16, 9000]], [[2, -4000], [18, -6000]]],
  ["aecho=0.5:1:0x1|0x2:0x0.8|0x1p-2", 32, [[0, 6000], [8, 6000], [16, 3000]], [[2, -4000], [10, -4000], [18, -2000]]],
  ["aecho=0:1:1:0.5", 24, [[8, 6000]], [[10, -4000]]],
  ["aecho=0.5:0:1:0.5", 24, [], []],
  ["aecho=0.5:1:1|2:0.5|0.25,atrim=start_sample=16", 16, [[0, 3000]], [[2, -2000]]],
  ["aecho=0.5:1:1|2:0.5|0.25,volume=0.5", 32, [[0, 3000], [8, 3000], [16, 1500]], [[2, -2000], [10, -2000], [18, -1000]]]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} mixes independent channels and drains the tail (${graph ? "graph" : "simple"})`, async () => {
      const { volume, result, stderr } = await run(filter, graph);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channelData.length, 2);
      for (const [channel, impulses] of [left, right].entries()) {
        const expected = new Float64Array(frames);
        for (const [frame, value] of impulses) expected[frame] = value / 32768;
        assert.deepEqual(Array.from(audio.channelData[channel]!), Array.from(expected));
      }
    });
  }
}

// Numeric gain options expose their own AVOption bounds and default.
for (const [filter, expected] of [
  ["aecho=PI/4:1:0.25:0.5", "aecho=0.7853981633974483:1:0.25:0.5"],
  ["aecho=E/4:1:0.25:0.5", "aecho=0.6795704571147613:1:0.25:0.5"],
  ["aecho=none:1:0.25:0.5", "aecho=0:1:0.25:0.5"],
  ["aecho=all+1:1:0.25:0.5", "aecho=0:1:0.25:0.5"],
  ["aecho=in_gain=1:out_gain=PI/4", "aecho=1:0.7853981633974483"],
  ["aecho=in_gain=1:out_gain=E/4", "aecho=1:0.6795704571147613"],
  ["aecho=in_gain=1:out_gain=none", "aecho=1:0"],
  ["aecho=in_gain=1:out_gain=all+1", "aecho=1:0"],
  ["aecho=in_gain=default", "aecho"],
  ["aecho=out_gain=default", "aecho"],
  ["aecho=default:default", "aecho"],
  ["aecho=in_gain=max:out_gain=min", "aecho=1:0"],
  ["aecho=in_gain=min:out_gain=max", "aecho=0:1"],
  ["aecho=in_gain=1:in_gain=default:out_gain=1:out_gain=default", "aecho"],
  ["aecho=in_gain=default/2:out_gain=default*2", "aecho=0.3:0.6"],
  ["aecho=(min+max)/2:max/2", "aecho=0.5:0.5"],
  ["aecho=in_gain=1/2", "aecho=0.5"]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} evaluates gain constants (${graph ? "graph" : "simple"})`, async () => {
      const literal = await run(expected, graph);
      const expression = await run(filter, graph);
      assert.equal(literal.result.exitCode, 0, literal.stderr);
      assert.equal(expression.result.exitCode, 0, expression.stderr);
      assert.deepEqual(expression.volume.readFileSync("/out.wav"), literal.volume.readFileSync("/out.wav"));
    });
  }
}

// Native PCM hashes also cover fractional gains, saturation, multiple input frames,
// and a default one-second tail, longer than both the input and a drain frame.
for (const [filter, frames, hash] of [
  ["aecho", 12096, "75c3fd63b0f5b0829fd061332cbe10aa04001651fe18624004e72bb26e6a47b4"],
  ["aecho=0.5:1:1|2:0.5|0.25", 4112, "545ec6a69e91a8c8fe9ab863ca8526ec6357a3c4d325e6e010d8a6aaa4256d87"],
  ["aecho=1:1:0.125|0.25:1|1", 4098, "d1dfe2c1171941ab3f9c2bdb0a97508cf8b079e34029f7606331633018f8b161"],
  ["aecho=in_gain=1/2:out_gain=1:delays=2|1:decays=0.25|0.5", 4112, "545ec6a69e91a8c8fe9ab863ca8526ec6357a3c4d325e6e010d8a6aaa4256d87"],
  ["aecho=0.5:out_gain=1:0.25:1:1|2:0.5|0.25", 4112, "19012753f938fde7d874eead20655eb247f835fd3a458b507e46b04fb6cc287c"]
] as const) {
  it(`${filter} matches native stereo PCM across frames`, async () => {
    const { volume, result, stderr } = await run(filter, false, 4096);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.channelData[0]!.length, frames);
    const pcm = Buffer.alloc(frames * 4);
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < 2; c++) pcm.writeInt16LE(audio.channelData[c]![i]! * 32768, i * 4 + c * 2);
    }
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}

// Native FFmpeg 7.0.2 produces the same PCM for hexadecimal and decimal delays.
for (const delay of ["16", "0x10", "0X10", "+0x10", "0x1p4", "0x0.8p5", "0x10ms", "16ms", "bad||0x10"]) {
  it(`aecho delay ${delay} matches native mono PCM`, async () => {
    const channels = [Float64Array.from({ length: 4096 }, (_, i) => ((i * 179) % 50001 - 25000) / 32768)];
    const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav", "-af", `aecho=0.6:0.4:${delay}:0.3`, "-f", "s16le", "/out.raw"],
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
    assert.equal(pcm.length, 8448);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), "94c45652bd533dce642f5f1a782db4ec5073343a0903d5c47c148efecae46eb5");
  });
}

// Native FFmpeg 7.0.2 counts explicit NaN entries but skips unparseable junk.
for (const [filter, expected] of [
  ["aecho=0.5:0.4:nan|1:0.25", "KEEP"],
  ["aecho=0.5:0.5:1:nan|0.5", "KEEP"],
  ["aecho=0.5:0.4:junk|1:0.25", "800c000000000000c0f90000000000004006000000000000e0fc000000000000"],
  ["aecho=0.5:0.5:1:junk|0.5", "a00f00000000000030f8000000000000a00f00000000000030f8000000000000"]
]) {
  for (const graph of [false, true]) {
    it(`${filter} counts NaN entries and skips junk (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from([16000, 0, 0, 0, -8000, 0, 0, 0], value => value / 32768)
      ] }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
      if (expected === "KEEP") {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("aecho: delays and decays must have matching entries"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
      }
    });
  }
}

for (const token of ["NaN", "+nan", "-NaN", "nan(payload)"]) {
  for (const filter of [`aecho=delays=${token}|1:decays=0.5`, `aecho=delays=1:decays=${token}|0.5`]) {
    it(`${filter} counts signed and case-insensitive NaN entries`, async () => {
      const { volume, result, stderr } = await run(filter);
      assert.notEqual(result.exitCode, 0);
      assert.ok(stderr.includes("aecho: delays and decays must have matching entries"), stderr);
      assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
    });
  }
}

// Native FFmpeg 7.0.2 PCM16 output for a low-gain echo and format negotiation.
for (const [filter, hash] of [
  ["aecho=0.02:0.1:20:0.02,volume=32", "0404dc78d101b86bd28ebea2e68a374244ddf45674b5aaeb55f092e22d0a4f0e"],
  ["aecho=0.02:0.1:20:0.02,volume=32:precision=double", "0404dc78d101b86bd28ebea2e68a374244ddf45674b5aaeb55f092e22d0a4f0e"],
  ["aecho=0.02:0.1:20:0.02,volume=32:precision=fixed", "13d194d1413746aa5d70f6d6415d764a53665c55b3be89e8cac56ebba9e91186"],
  ["aecho=0.02:0.1:20:0.02,volume=32:2", "0404dc78d101b86bd28ebea2e68a374244ddf45674b5aaeb55f092e22d0a4f0e"],
  ["aformat=sample_fmts=flt,aecho=0.02:0.1:20:0.02", "2e99453fba21b41a7fbd9057193f0d135671398dc85afb5293c4bf0525dcbb87"],
  ["aformat=sample_fmts=dbl,aecho=0.02:0.1:20:0.02", "ba2325539140841f16b466a9b227dad47af2f0a4e760065073406ccefc219b10"],
  ["aecho=0.02:0.1:20:0.02", "9c63d94ac2a56b1d7d8c61f1fe810f5309310fbd239cd5ff7900644d08ba4e6a"]
]) {
  for (const graph of [false, true]) {
    it(`${filter} preserves negotiated precision (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 4096 }, (_, i) => ((i * 179) % 50001 - 25000) / 32768)
      ] }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
      assert.equal(pcm.length, 8512);
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    });
  }
}

it("aecho makes the complete tail available to downstream frame filters", async () => {
  const { volume, result, stderr } = await run("aecho,aselect='gte(n,1)'");
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.equal(audio.channelData[0]!.length, 8000);
  assert.equal(audio.channelData[0]![7984], 1800 / 32768);
  assert.equal(audio.channelData[1]![7986], -1200 / 32768);
});

for (const filter of [
  "aecho=delays=-0x10", "aecho=delays=0x0", "aecho=delays=0x15f91", "aecho=decays=0x2",
  "aecho=0.5:1:-1:0.5", "aecho=delays=0", "aecho=delays=90001",
  "aecho=delays=1|2:decays=0.5", "aecho=decays=0",
  "aecho=decays=1.1", "aecho=delays=bad", "aecho=decays=bad",
  "aecho=in_gain=-1", "aecho=out_gain=1.1", "aecho=in_gain=NaN",
  "aecho=delays=Infinity", "aecho=unknown=1", "aecho=delays=2000"
]) {
  it(`${filter} preserves existing output on failure`, async () => {
    const { volume, result } = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

// Native FFmpeg 7.0.2 distinguishes option, gain, and list validation errors.
for (const [filter, exitCode, output] of [
  ["aecho=foo=1", 8, "4b454550"],
  ["aecho=2:1:1:0.5", 222, "4b454550"],
  ["aecho=in_gain=-1", 222, "4b454550"],
  ["aecho=in_gain=PI", 222, "4b454550"],
  ["aecho=out_gain=E", 222, "4b454550"],
  ["aecho=in_gain=all", 222, "4b454550"],
  ["aecho=out_gain=all", 222, "4b454550"],
  ["aecho=in_gain=min-0.1", 222, "4b454550"],
  ["aecho=out_gain=max+0.1", 222, "4b454550"],
  ["aecho=out_gain=1.1", 222, "4b454550"],
  ["aecho=0.5:0.4:1|2:0.25", 234, "4b454550"],
  ["aecho=0.5:0.5:1:0.5", 0, "a00f00000000000030f8000000000000a00f00000000000030f8000000000000"]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} returns native status and output bytes (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from([16000, 0, 0, 0, -8000, 0, 0, 0], value => value / 32768)
      ] }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.pcm"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal((volume.readFileSync("/out.pcm") as Buffer).toString("hex"), output);
      assert.equal(result.exitCode, exitCode, stderr);
    });
  }
}

it("zero-sample echo truncates existing WAV output on configuration failure", async () => {
  const { volume, result } = await run("aecho=delays=0.01");
  assert.equal(result.exitCode, 234);
  assert.equal((volume.readFileSync("/out.wav") as Buffer).length, 0);
});

async function run(filter: string, graph = false, frames = 16) {
  const channels = frames === 16 ? [new Float64Array(16), new Float64Array(16)] : [
    Float64Array.from({ length: frames }, (_, i) => ((i * 997) % 64000 - 32000) / 32768),
    Float64Array.from({ length: frames }, (_, i) => (32000 - (i * 829) % 64000) / 32768)
  ];
  if (frames === 16) {
    channels[0]![0] = 12000 / 32768;
    channels[1]![2] = -8000 / 32768;
  }
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 2 } }).execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-c:a", "pcm_s16le", "/out.wav"],
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
