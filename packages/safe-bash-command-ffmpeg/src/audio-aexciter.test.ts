import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg PCM16 hashes for the reported 48 kHz fixture, with an independent right channel.
for (const [filter, hash] of [
  ["aexciter=amount=3", "940b4c9a0717e4a9d4351d3fbb525056851dcac2f49691659823454ee0da3950"],
  ["aexciter", "b4a53666cf05defb3d50210154fd84a2b2b750588c0110dbbab59582796ba3be"],
  ["aexciter=level_in=0.7:level_out=0.8:amount=2:drive=4:blend=-3:freq=4000:ceil=12000:listen=1", "042f5636977ec745e6b653d5cfae47dd11467944046a3b76fe2e98c7a357811a"],
  ["volume=0.5,aexciter=1:0.8:2:9:4:6000:15000:0,areverse", "bb2d96974387c20d45eb6cb0a6745a214c2296bcf8458e64c55a71cb0edf6181"]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} matches native PCM and rate (${graph ? "graph" : "simple"})`, async () => {
      const { volume, result, stderr } = await run(filter, graph);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 48000);
      assert.equal(audio.channelData.length, 2);
      assert.equal(audio.channelData[0]!.length, 28800);
      const pcm = Buffer.alloc(28800 * 4);
      for (let i = 0; i < 28800; i++) {
        for (let c = 0; c < 2; c++) pcm.writeInt16LE(Math.round(audio.channelData[c]![i]! * 32768), i * 4 + c * 2);
      }
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    });
  }
}

it("matches the reported mono fixture at every sample", async () => {
  const { volume, result, stderr } = await run("aexciter=amount=3", false, true);
  assert.equal(result.exitCode, 0, stderr);
  const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.equal(audio.channelData.length, 1);
  assert.equal(audio.channelData[0]!.length, 28800);
  const pcm = Buffer.alloc(28800 * 2);
  for (let i = 0; i < 28800; i++) pcm.writeInt16LE(Math.round(audio.channelData[0]![i]! * 32768), i * 2);
  assert.equal(createHash("sha256").update(pcm).digest("hex"), "5556e44f2cf50c535998b4a71db9ef5a1edc0abf9d35df9d208989f7d3f5dab7");
  assert.deepEqual([600, 2200, 3000, 4600].map(i => pcm.readInt16LE(i * 2)), [564, 18060, 32767, 5460]);
});

for (const [expression, literal] of [
  ["amount=1+1", "amount=2"],
  ["level_in=1/2:level_out=2/4:amount=2*2:drive=8/2:blend=1-4:freq=2000*2:ceil=6000*2:listen=yes", "level_in=0.5:level_out=0.5:amount=4:drive=4:blend=-3:freq=4000:ceil=12000:listen=1"],
  ["1/2:2/4:2*2:8/2:1-4:2000*2:6000*2:off", "0.5:0.5:4:4:-3:4000:12000:0"]
]) {
  for (const graph of [false, true]) {
    it(`evaluates aexciter ${expression} (${graph ? "graph" : "simple"})`, async () => {
      const actual = await run(`aexciter=${expression}`, graph);
      const expected = await run(`aexciter=${literal}`, graph);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      assert.equal(actual.stderr, "");
      assert.deepEqual(actual.volume.readFileSync("/out.wav"), expected.volume.readFileSync("/out.wav"));
    });
  }
}

for (const graph of [false, true]) {
  for (const positional of [false, true]) {
    for (const [canonical, values] of [
      ["true", ["TRUE", "YeS", "ON", "1"]],
      ["false", ["FALSE", "nO", "OfF", "0"]]
    ] as const) {
      it(`accepts case-insensitive listen=${canonical} (${graph ? "graph" : "simple"}, ${positional ? "positional" : "named"})`, async () => {
        const expected = await run(`aexciter=listen=${canonical}`, graph, true);
        assert.equal(expected.result.exitCode, 0, expected.stderr);
        assert.equal(expected.stderr, "");
        for (const value of values) {
          const filter = positional ? `aexciter=1:1:1:8.5:0:7500:9999:${value}` : `aexciter=listen=${value}`;
          const actual = await run(filter, graph, true);
          assert.equal(actual.result.exitCode, 0, `${filter}: ${actual.stderr}`);
          assert.equal(actual.stderr, "");
          assert.deepEqual(actual.volume.readFileSync("/out.wav"), expected.volume.readFileSync("/out.wav"), filter);
        }
      });
    }
  }
}

for (const filter of ["aexciter=amount=1+", "aexciter=amount=1/0", "aexciter=amount=32+33", "aexciter=freq=2000-1", "aexciter=listen=1+0", "aexciter=amount=-1", "aexciter=drive=0", "aexciter=blend=11", "aexciter=freq=1999", "aexciter=ceil=20001", "aexciter=listen=2", "aexciter=listen=TrUeish", "aexciter=level_in=NaN", "aexciter=unknown=1"]) {
  it(`${filter} rejects invalid options without replacing output`, async () => {
    const { volume, result } = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

// Native FFmpeg 7.0.2 statuses for rejected AVOptions.
for (const [option, exitCode] of [
  ["drive=0", 222], ["amount=65", 222], ["listen=maybe", 234],
  ["amount=garbage", 234], ["unknown=1", 8]
] as const) {
  for (const graph of [false, true]) {
    for (const pipe of [false, true]) {
      it(`aexciter=${option} returns ${exitCode} without output (${graph ? "graph" : "simple"}, ${pipe ? "pipe" : "file"})`, async () => {
        const { volume, result, stdout, stderr } = await run(`asetnsamples=n=96:p=0,aexciter=${option}`, graph, true, pipe);
        assert.equal(result.exitCode, exitCode, stderr);
        assert.equal(stdout.length, 0);
        assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
      });
    }
  }
}

async function run(filter: string, graph = false, mono = false, pipe = false) {
  const period: number[] = [];
  for (const [amplitude, count] of [[0, 600], [400, 1600], [12000, 1600], [0, 800], [4000, 1600], [0, 1000]]) {
    for (let i = 0; i < count!; i++) period.push((i % 2 ? -amplitude! : amplitude!) / 32768);
  }
  const channels = [
    Float64Array.from({ length: 28800 }, (_, i) => period[i % period.length]!),
    Float64Array.from({ length: 28800 }, (_, i) => ((i * 53) % 12000 - 6000) / 32768)
  ];
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 48000, channels: mono ? channels.slice(0, 1) : channels }));
  let stderr = "";
  const stdout: Uint8Array[] = [];
  const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 3 } }).execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", ...(pipe ? ["-f", "s16le", "pipe:1"] : ["/out.wav"])],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { volume, result, stdout: Buffer.concat(stdout), stderr };
}
