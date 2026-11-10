import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg references for the reported stereo PCM16 fixture.
for (const [filter, hash] of [
  ["asetnsamples=n=256:p=0,agate=enable='not(mod(n,2))'", "84dc3bc929712cff0188664b5bcf25b73692b4fa53306a5baaf41bb9e761b7e1"],
  ["asetnsamples=n=256:p=0,asetpts=PTS+800,agate=enable='between(t,0.1,0.3)'", "b29d2d1b442e3eb1523a1d5a8f08ea519295ceaadd71d5e7ab959a77c81ac102"],
  ["agate=enable=0:level_in=2:makeup=3", "94d9ade717f48bd07308b581795d047819ea986aac4d9bfcc93fd6764c336ce3"],
  ["anull", "94d9ade717f48bd07308b581795d047819ea986aac4d9bfcc93fd6764c336ce3"],
  ["agate", "080a910cf94a6c0fb40d244fbad9515d2ac1d1d14176886ba64b35076e9c06dc"],
  ["agate=enable=0", "94d9ade717f48bd07308b581795d047819ea986aac4d9bfcc93fd6764c336ce3"],
  ["agate=enable=1", "080a910cf94a6c0fb40d244fbad9515d2ac1d1d14176886ba64b35076e9c06dc"],
  ["agate=enable=between(t\\,0.1\\,0.3)", "c4721cb2117c93e3cf1ce872bfb7e334d008370f5b2d3201d6a3641e1d9861ab"]
] as const) for (const graph of [false, true]) {
  it(`${filter} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
    const { volume, result, stderr } = await run(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    const pcm = volume.readFileSync("/out.pcm") as Buffer;
    assert.equal(pcm.length, 25600);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}

for (const enable of ["", "unknown", "gte(t,)"]) {
  it(`rejects invalid agate enable=${enable} without replacing output`, async () => {
    const { volume, result, stderr } = await run(`agate=enable='${enable}'`);
    assert.equal(result.exitCode, 1);
    assert.ok(stderr.includes("agate enable"), stderr);
    assert.equal(volume.readFileSync("/out.pcm", "utf8"), "keep");
  });
}

async function run(filter: string, graph = false) {
  const volume = Volume.fromJSON({ "/out.pcm": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    Float64Array.from({ length: 6400 }, (_, i) => ((i * 131) % 4001 - 2000) * [1, 6, 2, 0][Math.floor(i / 512) % 4]! / 32768),
    Float64Array.from({ length: 6400 }, (_, i) => ((i * 47) % 1801 - 900) * [2, 1, 16, 0][Math.floor(i / 512) % 4]! / 32768)
  ] }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-c:a", "pcm_s16le", "-f", "s16le", "/out.pcm"],
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
