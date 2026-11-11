import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = Float64Array.from({ length: 881 }, (_, i) =>
  (i === 440 ? 30000 : ((i % 13) - 6) * 100) / 32768);

// Native FFmpeg 7.0.2-static PCM16 references, including the final partial window.
for (const [name, enabled, timed, alternating, saved] of [
  ["adeclick", "d96fa0b119b3ef22cdf412d07579408e1971413c2b2e6d25d267adeeeb6b3f32",
    "73a79862e65c15b6b9d12d3bda31b79930fb0877c903e3dc0f62033c5e9c91e5",
    "1e59b503a6fe9bdf549635836eed118baed68f47e4b91ea3b1d067d4dcae4fef",
    "5a921982ae53a07fa603a2fb8ba0250b66235e09c97a32ca1f46c2eb8bda333c"],
  ["adeclip", "c7955d03958dd9eb6a1201f3ca30c3b8cb4c73bb41cc543ed940c1ecb3d9bf86",
    "8ef29269127feec71ca037822d81b5f4e949bfe45503f023667569bee103ef0f",
    "f3b5375811f842bde6974012c4e6be406cefc66e4fb368c85cfbacb270269d0f",
    "c443aea46369afd717819a6ea4d4c43464f373cbd33a877bb6e38d56e69ad46f"]
] as const) {
  for (const graph of [false, true]) {
    for (const [filter, hash] of [
      [`${name}=enable=0`, "9d3a6a533f4a096412dffe46f4075c55272489479f7e4cb96d40cdbc5507288e"],
      [`${name}=enable=0.25`, "9d3a6a533f4a096412dffe46f4075c55272489479f7e4cb96d40cdbc5507288e"],
      [`${name}=enable=1`, enabled],
      [`${name}=enable=-1`, enabled],
      [`${name}=enable='gte(t,0.05)'`, timed],
      [`${name}=enable=gte(t\\,0.05)`, timed],
      [`${name}=enable='not(mod(n,2))'`, alternating],
      [`${name}=enable='gt(st(0,ld(0)+1),1)'`, timed],
      [`${name}=m=save:enable='gte(t,0.05)'`, saved],
      [`asetnsamples=n=100:p=0,${name}=enable='gte(t,0.05)'`, timed],
      [`asetpts=PTS+800,${name}=enable='gte(t,0.05)'`, enabled]
    ]) {
      it(`${filter} matches native timeline PCM (${graph ? "graph" : "simple"})`, async () => {
        const { volume, result, stderr } = await run(filter!, graph);
        assert.equal(result.exitCode, 0, stderr);
        const pcm = volume.readFileSync("/out.pcm") as Buffer;
        assert.equal(pcm.length, samples.length * 2);
        assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
      });
    }
    for (const enable of ["0", "1"]) {
      it(`${name}=enable=${enable} retains short-window output (${graph ? "graph" : "simple"})`, async () => {
        const { volume, result, stderr } = await run(`${name}=enable=${enable}`, graph,
          Float64Array.from([-600, -500, 30000, -300], value => value / 32768));
        assert.equal(result.exitCode, 0, stderr);
        assert.equal((volume.readFileSync("/out.pcm") as Buffer).toString("hex"), "fefffdff1101fcff");
      });
    }
  }
  for (const enable of ["", "unknown", "gte(t,)"]) {
    it(`${name} rejects invalid enable=${enable} without overwriting output`, async () => {
      const { volume, result, stderr } = await run(`${name}=enable='${enable}'`);
      assert.equal(result.exitCode, 1);
      assert.ok(stderr.includes(`${name} enable`), stderr);
      assert.equal(volume.readFileSync("/out.pcm", "utf8"), "keep");
    });
  }
}

for (const [length, name, hash] of [
  [441, "adeclick", "ea4a1ab1e7670d38f5f4768accf547ed9326452656e454e9d1fccf9120a14501"],
  [441, "adeclip", "962844eb2eb6a42937826109acea937ce03a92d2779d4498ca759cd9ca61318a"],
  [499, "adeclick", "ad95e51d0d6e330503b300aa1c33c9183261829036b002cfcf4da34c74bccc9c"],
  [499, "adeclip", "22a3a10d86346d37c48f5f688eaaaa63e28ce3c602c42ebeb3aaa96c5faa92b7"]
] as const) {
  it(`${name} retains the enable buffer at a ${length}-sample overlap-save tail`, async () => {
    const input = Float64Array.from({ length }, (_, i) =>
      (i === length - 40 || i === 440 ? 30000 : ((i % 13) - 6) * 100) / 32768);
    const { volume, result, stderr } = await run(`${name}=m=save:enable='not(mod(n,2))'`, false, input);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(createHash("sha256").update(volume.readFileSync("/out.pcm") as Buffer).digest("hex"), hash);
  });
}

async function run(filter: string, graph = false, input = samples) {
  const volume = Volume.fromJSON({ "/out.pcm": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [input] }));
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
  return { volume, result, stderr };
}
