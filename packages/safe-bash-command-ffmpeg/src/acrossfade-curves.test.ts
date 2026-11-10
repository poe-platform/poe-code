import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import curves from "./acrossfade-curves-fixtures.json" with { type: "json" };
import { createFfmpegCommand } from "./index.js";

async function run(options: string, channels = 1, values = [12000, -4000]) {
  const volume = Volume.fromJSON({ "/out.wav": "sentinel" });
  for (const [index, name] of ["a", "b"].entries()) {
    const value = values[index]!;
    volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
      channels: Array.from({ length: channels }, () => new Float64Array(1000).fill(value / 32768)) }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
      `[0:a][1:a]acrossfade=${options}[mix]`, "-map", "[mix]", "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: volume.readFileSync("/out.wav") };
}

for (const key of ["c1", "curve1", "c2", "curve2", "positional"]) {
  for (const value of ["0", "0.0", "1-1", "0+0", "tri+0"]) {
    it(`acrossfade ${key}=${value} matches triangular PCM exactly`, async () => {
      const expected = await run("ns=128:c1=tri:c2=tri");
      const actual = await run(key === "positional" ? `128:0:1:${value}:${value}` : `ns=128:${key}=${value}`);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.equal(parseWav(actual.output as Buffer).tracks[0]!.decodedAudio!.channelData[0]!.length, 1872);
      assert.deepEqual(actual.output, expected.output);
    });
  }
  for (const [value, curve] of [
    ["min", "nofade"], ["max", "hsin2"], ["default", "tri"],
    ["min+1", "tri"], ["max-1", "qsin2"], ["default+1", "qsin"]
  ] as const) {
    it(`acrossfade ${key}=${value} resolves option constants to ${curve}`, async () => {
      const expected = await run(key === "positional" ? `128:0:1:${curve}:${curve}` : `ns=128:${key}=${curve}`);
      const actual = await run(key === "positional" ? `128:0:1:${value}:${value}` : `ns=128:${key}=${value}`);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.deepEqual(actual.output, expected.output);
    });
  }
  for (const value of ["23", "22.1", "-1.1", "max+0.1", "min-0.1", "1/0", "0/0", "0+", "bogus", ""]) {
    it(`acrossfade rejects ${key}=${value} without replacing output`, async () => {
      const actual = await run(key === "positional" ? `128:0:1:${value}:${value}` : `ns=128:${key}=${value}`);
      assert.equal(actual.result.exitCode, 1, actual.stderr);
      assert.ok(actual.stderr.includes("acrossfade:"), actual.stderr);
      assert.equal(actual.output.toString(), "sentinel");
    });
  }
}

// Signed PCM captured from FFmpeg 7.0.2 using 1,000-frame, 8 kHz inputs
// containing 12000 and -4000. Compare audio, not WAV container headers.
for (const [curve, expected] of Object.entries(curves)) {
  for (const key of ["c1", "c2"] as const) {
    for (const channels of [1, 2]) {
      it(`acrossfade ${key}=${curve} matches native PCM (${channels} channels)`, async () => {
        const actual = await run(`ns=4:${key}=${curve}`, channels);
        assert.equal(actual.result.exitCode, 0, actual.stderr);
        const audio = parseWav(actual.output as Buffer).tracks[0]!.decodedAudio!;
        assert.equal(audio.sampleRate, 8000);
        assert.equal(audio.channels, channels);
        assert.equal(audio.channelMask, undefined);
        for (const channel of audio.channelData) {
          assert.deepEqual(Array.from(channel, value => value * 32768), [
            ...new Array(996).fill(12000), ...expected[key], ...new Array(996).fill(-4000)
          ]);
        }
      });
    }
  }
}

for (const [options, transition] of [
  ["ns=4:c1=nofade:c2=qua", [12000, 11750, 11000, 9750]],
  ["4:0:1:-1:3+3", [12000, 11750, 11000, 9750]],
  ["ns=4:curve1=nofade:curve2=qua", [12000, 11750, 11000, 9750]],
  ["ns=4:o=0:c1=qua:c2=qsin", [6750, 3000, 750, 0, 0, -1530, -2828, -3695]],
  ["4:0:0:6:1", [6750, 3000, 750, 0, 0, -1530, -2828, -3695]]
] as const) {
  it(`acrossfade selects independent curves (${options})`, async () => {
    const actual = await run(options);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    const channel = parseWav(actual.output as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.deepEqual(Array.from(channel, value => value * 32768), [
      ...new Array(996).fill(12000), ...transition, ...new Array(996).fill(-4000)
    ]);
  });
}

for (const [index, [curve, expected]] of Object.entries(curves).entries()) {
  for (const key of ["c1", "c2"] as const) {
    it(`acrossfade curve${key[1]}=${index - 1} selects ${curve}`, async () => {
      const actual = await run(`ns=4:curve${key[1]}=${index - 1}`);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      const channel = parseWav(actual.output as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
      assert.deepEqual(Array.from(channel.slice(996, 1000), value => value * 32768), expected[key]);
    });
  }
  it(`acrossfade ${curve} matches native non-overlap PCM`, async () => {
    const actual = await run(`ns=4:o=0:c1=${curve}:c2=${curve}`);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    const channel = parseWav(actual.output as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.deepEqual(Array.from(channel, value => value * 32768), [
      ...new Array(996).fill(12000), ...expected.separate, ...new Array(996).fill(-4000)
    ]);
  });
}

for (const [value, curve] of [["-0.5", "tri"], ["0.5", "tri"], ["1.5", "esin"],
  ["2.5", "esin"], ["21.5", "hsin2"], ["qsin+1", "esin"]] as const) {
  it(`acrossfade rounds curve expression ${value} to ${curve}`, async () => {
    const actual = await run(`ns=4:c1=${value}`);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    const channel = parseWav(actual.output as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.deepEqual(Array.from(channel.slice(996, 1000), value => value * 32768), curves[curve].c1);
  });
}

for (const [input, expected] of [[30000, -5536], [-30000, 5536]] as const) {
  it(`acrossfade casts overlapping nofade PCM16 samples (${input})`, async () => {
    const actual = await run("ns=4:c1=nofade:c2=nofade", 1, [input, input]);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    const channel = parseWav(actual.output as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.deepEqual(Array.from(channel, value => value * 32768), [
      ...new Array(996).fill(input), ...new Array(4).fill(expected), ...new Array(996).fill(input)
    ]);
  });
}
