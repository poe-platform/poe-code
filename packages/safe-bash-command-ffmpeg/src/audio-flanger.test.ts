import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete native FFmpeg 9.0.1 PCM waveforms, including modulation across input frames.
const cases = [
  [
    "anull",
    256,
    false,
    "3937c7b9c7de63ad7fed4ab7b3898f773c2e30f8e08587139a48c9ce530ee518"
  ],
  [
    "flanger",
    256,
    false,
    "3937c7b9c7de63ad7fed4ab7b3898f773c2e30f8e08587139a48c9ce530ee518"
  ],
  [
    "flanger=delay=2:depth=4:regen=20:width=60:speed=2",
    256,
    false,
    "db603ff4db3d72c353fca39e20849b962750ccbacd9c1dc4f7974054c041ae62"
  ],
  [
    "flanger",
    4096,
    true,
    "b5352f0c273fb0c699e88106201950935e78c082c62c315f0b8598bd631983df"
  ],
  [
    "flanger=2:4:-20:60:2:t:50:quadratic",
    4096,
    true,
    "29a058ba00f8e58a36be35070e72ccf4d11c5fbac3ada59bfdf7f12091fed809"
  ],
  [
    "flanger=delay=0:depth=0",
    4096,
    true,
    "b8e07252e145566b6109db727c5778e407ba3f41ba4deffc82475f0850fb0fa0"
  ],
  [
    "flanger=delay=0.0625:depth=4:regen=95:speed=3:phase=75:interp=quadratic",
    4096,
    true,
    "ca235ec0367d1bea7bed02dbf756d3023a23bf6aacbe214a496cf45c6b167c56"
  ]
] as const;
for (const [filter, frames, stereo, hash] of cases) {
  for (const graph of [false, true]) {
    it(`${filter} matches native PCM (${frames} frames, graph=${graph})`, async () => {
      const { volume, result, stderr } = await run(filter, frames, stereo, graph);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = volume.readFileSync("/out.s16") as Buffer;
      assert.equal(pcm.length, frames * (stereo ? 4 : 2));
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
      if (filter === "flanger=delay=2:depth=4:regen=20:width=60:speed=2") {
        // Also matches the reported FFmpeg 7.0.2 impulse response.
        for (const [index, value] of [[0, 10000], [16, 4776], [17, 27], [33, 935]]) {
          assert.equal(pcm.readInt16LE(index! * 2), value);
        }
      }
    });
  }
}

for (const [expression, decimal] of [
  ["PI", "3.141592653589793"],
  ["E", "2.718281828459045"],
  ["PHI", "1.618033988749895"],
  ["PI/2", "1.5707963267948966"],
  ["1+1", "2"]
]) {
  for (const graph of [false, true]) {
    it(`flanger delay=${expression} matches its decimal control (graph=${graph})`, async () => {
      const control = await run(`flanger=delay=${decimal}`, 4096, true, graph);
      assert.equal(control.result.exitCode, 0, control.stderr);
      const actual = await run(`flanger=delay=${expression}`, 4096, true, graph);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.equal((actual.volume.readFileSync("/out.s16") as Buffer).length, 16384);
      assert.deepEqual(actual.volume.readFileSync("/out.s16"), control.volume.readFileSync("/out.s16"));
    });
  }
}

for (const graph of [false, true]) {
  for (const option of ["threads=1", "thread_type=slice", "extra_hw_frames=1",
    "threads=0:thread_type=none:extra_hw_frames=-1",
    "threads=max:thread_type=all-slice:extra_hw_frames=max",
    "threads=default:thread_type=+slice:extra_hw_frames=min",
    "threads=1+1:extra_hw_frames=0.5"]) {
    it(`flanger ${option} preserves complete default PCM (graph=${graph})`, async () => {
      const channels = [
        Float64Array.from({ length: 16 }, (_, i) => (1000 + i * 97) / 32768),
        Float64Array.from({ length: 16 }, (_, i) => ((i * 257) % 20001 - 10000) / 32768)
      ];
      const control = await run("flanger", 16, true, graph, "s16le", channels, 1000);
      assert.equal(control.result.exitCode, 0, control.stderr);
      const actual = await run(`flanger=${option}`, 16, true, graph, "s16le", channels, 1000);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      const pcm = actual.volume.readFileSync("/out.s16") as Buffer;
      assert.equal(pcm.length, 64);
      assert.deepEqual(pcm, control.volume.readFileSync("/out.s16"));
      assert.equal(createHash("sha256").update(pcm).digest("hex"),
        "3ec023179765761e298eee4e944b7840182d88d5f0dd54600ccac901ccd75908");
    });
  }
  for (const [option, status] of [
    ["threads=-1", 222], ["threads=2147483648", 222], ["threads=", 234],
    ["thread_type=bogus", 234], ["thread_type=0.5", 222],
    ["extra_hw_frames=-2", 222], ["extra_hw_frames=2147483648", 222],
    ["extra_hw_frames=bogus", 234]
  ] as const) {
    it(`rejects flanger ${option} and preserves output (graph=${graph})`, async () => {
      const { volume, result, stderr } = await run(`flanger=${option}`, 16, true, graph);
      assert.equal(result.exitCode, status, stderr);
      assert.equal(volume.readFileSync("/out.s16", "utf8"), "keep");
    });
  }
}

it("matches native PCM for the final-separator stereo regression", async () => {
  const channels = Array.from({ length: 2 }, (_, c) =>
    Float64Array.from({ length: 8000 }, (_, i) => ((i * 997 + c * 149) % 60001 - 30000) / 32768));
  const { volume, result, stderr } = await run("flanger=2:3:", 8000, true, false, "s16le", channels);
  assert.equal(result.exitCode, 0, stderr);
  const pcm = volume.readFileSync("/out.s16") as Buffer;
  assert.equal(pcm.length, 32000);
  assert.equal(createHash("sha256").update(pcm).digest("hex").slice(0, 16), "2b3a475db3b0c323");
});

for (const stereo of [false, true]) {
  for (const graph of [false, true]) {
    for (const options of ["2:3", "delay=2:depth=3", "2:4:-20:60:2:t:50:quadratic"]) {
      it(`accepts a final flanger separator (${options}, stereo=${stereo}, graph=${graph})`, async () => {
        const control = await run(`flanger=${options}`, 4096, stereo, graph);
        assert.equal(control.result.exitCode, 0, control.stderr);
        const actual = await run(`flanger=${options}:`, 4096, stereo, graph);
        assert.equal(actual.result.exitCode, 0, actual.stderr);
        assert.deepEqual(actual.volume.readFileSync("/out.s16"), control.volume.readFileSync("/out.s16"));
      });
    }
  }
}

for (const [key, min, max, fallback] of [
  ["delay", 0, 30, 0], ["depth", 0, 10, 2], ["regen", -95, 95, 0],
  ["width", 0, 100, 71], ["speed", 0.1, 10, 0.5], ["shape", 0, 1, 0],
  ["phase", 0, 100, 25], ["interp", 0, 1, 0]
] as const) {
  for (const [expression, decimal] of [["min", min], ["max", max], ["default", fallback]] as const) {
    for (const graph of [false, true]) {
      it(`flanger ${key}=${expression} matches its numeric control (graph=${graph})`, async () => {
        const control = await run(`flanger=${key}=${decimal}`, 4096, true, graph);
        assert.equal(control.result.exitCode, 0, control.stderr);
        const actual = await run(`flanger=${key}=${expression}`, 4096, true, graph);
        assert.equal(actual.result.exitCode, 0, actual.stderr);
        assert.deepEqual(actual.volume.readFileSync("/out.s16"), control.volume.readFileSync("/out.s16"));
      });
    }
  }
  it(`flanger ${key}=default restores its declared default after another value`, async () => {
    const control = await run("flanger", 4096, true);
    assert.equal(control.result.exitCode, 0, control.stderr);
    const actual = await run(`flanger=${key}=${max}:${key}=default`, 4096, true);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.deepEqual(actual.volume.readFileSync("/out.s16"), control.volume.readFileSync("/out.s16"));
  });
}

for (const [filter, controlFilter] of [
  ["flanger=min:default:min:max:default:max:max:max", "flanger=0:2:-95:100:0.5:1:100:1"],
  ["flanger=delay=max/2:depth=default+1:regen=(min+max)/2", "flanger=delay=15:depth=3:regen=0"]
] as const) {
  it(`${filter} matches its numeric control`, async () => {
    const control = await run(controlFilter, 4096, true);
    assert.equal(control.result.exitCode, 0, control.stderr);
    const actual = await run(filter, 4096, true);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.deepEqual(actual.volume.readFileSync("/out.s16"), control.volume.readFileSync("/out.s16"));
  });
}

for (const [filter, hash] of [
  ["flanger=width=max", "94455be957e7051f5b99ff16555bba7f2d90c5d389920f1fac289a65134d05c0"],
  ["flanger=depth=default", "fdb04b2db81321da155640d737e69597384ccda4b5606211becbbdd6152f5b10"]
] as const) {
  it(`${filter} matches the native stereo PCM regression fixture`, async () => {
    const channels = [0, 1].map(c => Float64Array.from({ length: 8000 },
      (_, i) => ((i * 997 + c * 149) % 60001 - 30000) / 32768));
    const { volume, result, stderr } = await run(filter, 8000, true, false, "s16le", channels);
    assert.equal(result.exitCode, 0, stderr);
    const pcm = volume.readFileSync("/out.s16") as Buffer;
    assert.equal(pcm.length, 32000);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}

for (const option of ["2::3", "2:3::", "delay=2:depth=", "delay=-1", "depth=11", "regen=96", "width=101", "speed=0", "phase=101", "shape=bad", "interp=2", "unknown=1", "delay=NaN", "delay=PI*10", "width=max+1", "speed=min/2", "depth=default+10"]) {
  it(`rejects ${option} without replacing output`, async () => {
    const { volume, result } = await run(`flanger=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.s16", "utf8"), "keep");
  });
}

for (const [option, exitCode] of [["phase=101", 222], ["foo=1", 8], ["shape=bad", 234], ["enable=0", 176]] as const) {
  for (const graph of [false, true]) {
    it(`returns native exit ${exitCode} for ${option} and preserves output (graph=${graph})`, async () => {
      const { volume, result, stderr } = await run(`flanger=${option}`, 12, true, graph);
      assert.equal(result.exitCode, exitCode, stderr);
      assert.equal(volume.readFileSync("/out.s16", "utf8"), "keep");
    });
  }
}

it("accepts the maximum phase of 100", async () => {
  const { volume, result, stderr } = await run("flanger=phase=100", 12, true);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal((volume.readFileSync("/out.s16") as Buffer).length, 48);
});

// Native FFmpeg 7.0.2 hashes for the complete interleaved output.
for (const [interp, format, hash] of [
  ["quadratic", "f64le", "2403c6530f2448643263ecb12b191f2f0d1f71ca48c1a2f5509d9e96c19e5c70"],
  ["linear", "f64le", "1ee6a7d6f3cae7c9af6b3733627cda9e060c07961f54c882c682848f5009673c"],
  ["quadratic", "s16le", "2980a8d83baec22ce44a6429354b8662ce049f29ec98102c39b8232f416bc018"]
] as const) {
  it(`matches native ${interp} interpolation rounding in ${format}`, async () => {
    const channels = [
      Float64Array.from({ length: 40 }, (_, i) => ((i * 19991 + 123) % 44001 - 22000) / 32768),
      Float64Array.from({ length: 40 }, (_, i) => ((i * 839 + 501) % 42001 - 21000) / 32768)
    ];
    const { volume, result, stderr } = await run(
      `flanger=delay=1:depth=3:regen=95:width=100:speed=9.3:interp=${interp}`,
      40, true, false, format, channels, 11025
    );
    assert.equal(result.exitCode, 0, stderr);
    const pcm = volume.readFileSync("/out.s16") as Buffer;
    assert.equal(pcm.length, 80 * (format === "f64le" ? 8 : 2));
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}

for (const graph of [false, true]) {
  for (const options of [
    "width=50",
    String.raw`width=st(0\,25)+ld(0)`,
    "width='st(9,25);ld(9)*2'",
    "width=ld(0)+50",
    "width='st(0,25)':width=ld(0)+50",
    "width='st(0,50)':depth=ld(0)+2"
  ]) {
    it(`flanger register options match native width=50 (${options}, graph=${graph})`, async () => {
      const channels = [
        Float64Array.from({ length: 16 }, (_, i) => (1000 + i * 97) / 32768),
        Float64Array.from({ length: 16 }, (_, i) => ((i * 257) % 20001 - 10000) / 32768)
      ];
      const { volume, result, stderr } = await run(`flanger=${options}`, 16, true, graph, "s16le", channels, 1000);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = volume.readFileSync("/out.s16") as Buffer;
      assert.equal(pcm.length, 64);
      assert.equal(createHash("sha256").update(pcm).digest("hex"),
        "c9e4258b99b8ad451e74e322e01a88da4d43eb6eccede939d74fabf0718bc0fd");
    });
  }
  it(`rejects out-of-range flanger register values (graph=${graph})`, async () => {
    const { volume, result, stderr } = await run("flanger=width='st(0,101)'", 16, true, graph);
    assert.equal(result.exitCode, 222, stderr);
    assert.equal(volume.readFileSync("/out.s16", "utf8"), "keep");
  });
}

async function run(filter: string, frames = 256, stereo = false, graph = false, format = "s16le",
  channels = Array.from({ length: stereo ? 2 : 1 }, (_, c) =>
    Float64Array.from({ length: frames }, (_, i) =>
      (stereo ? (i * 997 + c * 831) % 32000 - 16000 : i === 0 ? 16000 : 0) / 32768)), sampleRate = 8000) {
  const volume = Volume.fromJSON({ "/out.s16": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate, channels }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-c:a", `pcm_${format}`, "-f", format, "/out.s16"],
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
