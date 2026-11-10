import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// SHA-256 of decoded PCM from native FFmpeg 9.0.1, 8 kHz stereo, 2048 frames.
// The reported FFmpeg 7.0.2 samples also match the first fixture.
for (const [filter, hash] of [
  ["tremolo=f=5:d=0.75", "4fb74ecb8e96ed445a16f8d4dc2645671664927ca90a1ee2e6e2a72951243785"],
  ["tremolo", "3d83cb10b45d07571226cde3f64d700a024c3b88b59511f982c03c0122fa0b8c"],
  ["tremolo=7.3:1", "b13296571089f2d5c458a18f0780013fee877a29246f2a1d0e62ce8f3659ec2e"],
  ["tremolo=d=0", "2d1f2da800b2a477fbc52839146c0d3fd2c94a18c404a368f734448dbdf3d8ef"],
  ["tremolo=f=20000:d=0.5", "2d1f2da800b2a477fbc52839146c0d3fd2c94a18c404a368f734448dbdf3d8ef"]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} matches native PCM and rate (${graph ? "graph" : "simple"})`, async () => {
      const { volume, result, stderr } = await run(filter, graph);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channelData.length, 2);
      assert.equal(audio.channelData[0]!.length, 2048);
      const pcm = Buffer.alloc(2048 * 4);
      for (let i = 0; i < 2048; i++) {
        for (let c = 0; c < 2; c++) pcm.writeInt16LE(Math.round(audio.channelData[c]![i]! * 32768), i * 4 + c * 2);
      }
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    });
  }
}

// Native FFmpeg 7.0.2 s16le output for 16 mono samples of value 16000.
for (const [mixed, named, hex] of [
  ["tremolo=1:d=1:500", "tremolo=f=500:d=1", "803e1f3c5935352b401f4b13270961020000610227094b13401f352b59351f3c"],
  ["tremolo=1:enable=1:1000", "tremolo=f=1000:enable=1", "803eec39e02ed423401fd423e02eec39803eec39e02ed423401fd423e02eec39"]
] as const) {
  for (const graph of [false, true]) {
    it(`${mixed} matches named options and native PCM (${graph ? "graph" : "simple"})`, async () => {
      const channels = [new Float64Array(16).fill(16000 / 32768)];
      const expected = await run(named, graph, channels);
      const actual = await run(mixed, graph, channels);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.deepEqual(actual.volume.readFileSync("/out.wav"), expected.volume.readFileSync("/out.wav"));
      const samples = parseWav(actual.volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
      const pcm = Buffer.alloc(samples.length * 2);
      for (let i = 0; i < samples.length; i++) pcm.writeInt16LE(Math.round(samples[i]! * 32768), i * 2);
      assert.equal(pcm.toString("hex"), hex);
    });
  }
}

for (const [expression, literal] of [
  ["tremolo=d=1/2", "tremolo"],
  ["tremolo=d=(1+2)/4", "tremolo=d=0.75"],
  ["tremolo=d=sin(PI/6)", "tremolo=d=0.5"],
  ["tremolo=d=500m", "tremolo=d=0.5"],
  ["tremolo=10/2:2^-1", "tremolo=5:0.5"]
] as const) {
  for (const graph of [false, true]) {
    it(`${expression} matches literal options (${graph ? "graph" : "simple"})`, async () => {
      const expected = await run(literal, graph);
      const actual = await run(expression, graph);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.deepEqual(actual.volume.readFileSync("/out.wav"), expected.volume.readFileSync("/out.wav"));
    });
  }
}

for (const filter of ["tremolo=d=0b1", "tremolo=d=0o1", "tremolo=d=1/0", "tremolo=d=1+1", "tremolo=d=1-2", "tremolo=d=1/", "tremolo=f=1/20", "tremolo=f=20000+1"]) {
  for (const graph of [false, true]) {
    it(`${filter} rejects invalid expressions without replacing output (${graph ? "graph" : "simple"})`, async () => {
      const { volume, result } = await run(filter, graph);
      assert.notEqual(result.exitCode, 0);
      assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
    });
  }
}

// Full PCM hashes from native FFmpeg 9.0.1 using the reported 12000-sample ramp.
for (const [filter, hash] of [
  ["tremolo=enable=0", "4a4116fd94e0999680bcffd803b7bd9c551a885cfb7c5b2ea3c2509bfad43f91"],
  ["tremolo=enable=1", "1d7fd07b91e8cd81e28116c5fc43ac4d1b8f8e04e58a73ac424b8f68af087df3"],
  ["tremolo=enable='gte(t,0.5)'", "d09c09a04a6a3e1d2395d2613aa9f439e3e8a5d1b08fa40e47fb82ec9cf2dae7"],
  ["tremolo=enable='lt(t,0.2)+gte(t,0.7)'", "cb49eb2cf9a85773bf57d861928db5d92f9179fd3762c4dc72910251523d1fdb"],
  ["asetnsamples=1024:0,tremolo=enable='gt(n,0)'", "eb9c8df1a45bd9e0940f900cc6ca03d677f9c0db56545b175227786da2d7dd5c"],
  ["asetpts=PTS+4096,tremolo=enable='gte(t,0.5)'", "1d7fd07b91e8cd81e28116c5fc43ac4d1b8f8e04e58a73ac424b8f68af087df3"]
] as const) {
  for (const graph of [false, true]) it(`${filter} matches all native timeline samples (${graph ? "graph" : "simple"})`, async () => {
    const channels = [Float64Array.from({ length: 12000 }, (_, i) => ((217 + i * 9571) % 65536 - 32768) / 32768)];
    const { volume, result, stderr } = await run(filter, graph, channels);
    assert.equal(result.exitCode, 0, stderr);
    const samples = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.equal(samples.length, 12000);
    const pcm = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i++) pcm.writeInt16LE(Math.round(samples[i]! * 32768), i * 2);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}

// Native FFmpeg 7.0.2: 16 constant PCM16 samples, split into four-sample frames.
for (const enable of ["PI", "E", "PHI", "1", "0"]) {
  for (const graph of [false, true]) {
    it(`tremolo enable=${enable} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
      const { volume, result, stderr } = await run(
        `asetnsamples=n=4:p=0,tremolo=f=1000:d=1:enable=${enable}`,
        graph, [new Float64Array(16).fill(16000 / 32768)]
      );
      assert.equal(result.exitCode, 0, stderr);
      const samples = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
      const pcm = Buffer.alloc(samples.length * 2);
      for (let i = 0; i < samples.length; i++) pcm.writeInt16LE(Math.round(samples[i]! * 32768), i * 2);
      assert.equal(pcm.toString("hex"), enable === "0"
        ? "803e".repeat(16)
        : "803e5935401f270900002709401f5935803e5935401f270900002709401f5935");
    });
  }
}

for (const enable of ["", "unknown", "gte(t,)"]) {
  it(`rejects invalid tremolo enable=${enable} without replacing output`, async () => {
    const { volume, result, stderr } = await run(`tremolo=enable='${enable}'`);
    assert.equal(result.exitCode, 1);
    assert.ok(stderr.includes("tremolo enable"), stderr);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

for (const filter of ["tremolo=f=0", "tremolo=f=20001", "tremolo=d=-1", "tremolo=d=1.1", "tremolo=f=NaN", "tremolo=d=", "tremolo=unknown=1"]) {
  it(`${filter} rejects invalid options without replacing output`, async () => {
    const { volume, result } = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

async function run(filter: string, graph = false, channels = [
  Float64Array.from({ length: 2048 }, (_, i) => ((i * 67) % 14000 - 7000) / 32768),
  Float64Array.from({ length: 2048 }, (_, i) => (6000 - (i * 53) % 12000) / 32768)
]) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 3 } }).execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
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
