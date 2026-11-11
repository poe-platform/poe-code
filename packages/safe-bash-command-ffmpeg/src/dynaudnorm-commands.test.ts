import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, graph: boolean) {
  const samples = Float64Array.from({ length: 120 }, (_, i) =>
    (i % 2 ? 1 : -1) * (i < 60 ? 500 : 5000) / 32768);
  const fs = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({
    sampleRate: 1000, channels: [samples, samples.map(value => value * 4)]
  })) });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
      : ["-af", filter]), "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); } },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const output = fs.readFileSync("/out.pcm") as Buffer;
  assert.equal(output.length, 480);
  return output;
}

for (const graph of [false, true]) {
  // Full PCM16 references from native FFmpeg 7.0.2, including buffered gain history.
  for (const [filter, hash] of [
    ["dynaudnorm=f=10:g=3", "edd66bebed21c08fa8edd22df980ee19488921dd9a5cfbe84cd3659a2a1fb33a"],
    ["dynaudnorm=f=10:g=3:p=0.1", "c21b0cc7261d094865414eb56cfe92594e5fb880d507e542a612c53b1a44a65c"],
    ["asendcmd=c='0 dynaudnorm peak 0.1',dynaudnorm=f=10:g=3", "c21b0cc7261d094865414eb56cfe92594e5fb880d507e542a612c53b1a44a65c"],
    ["asendcmd=c='0.06 dynaudnorm peak 0.1',dynaudnorm=f=10:g=3", "6588f09e962819140a9e942964a68af63ed4c5ba2342eef72693028ac0c5781c"],
    ["asendcmd=c='0.06 dynaudnorm@norm p 1/10',dynaudnorm@norm=f=10:g=3", "6588f09e962819140a9e942964a68af63ed4c5ba2342eef72693028ac0c5781c"],
    ["asendcmd=c='0.06 dynaudnorm@other peak 0.1',dynaudnorm@norm=f=10:g=3", "edd66bebed21c08fa8edd22df980ee19488921dd9a5cfbe84cd3659a2a1fb33a"],
    ["asendcmd=c='0.06 dynaudnorm peak 0.1',dynaudnorm@first=f=10:g=3,dynaudnorm@second=f=10:g=3", "d9e2b74795572039307a7f5def8deac02b3cda783eeac140e513ba88d4de9f35"],
    ["asendcmd=c='0 dynaudnorm peak invalid;0.06 dynaudnorm peak 0.1',dynaudnorm=f=10:g=3", "6588f09e962819140a9e942964a68af63ed4c5ba2342eef72693028ac0c5781c"],
    ["asendcmd=c='0 dynaudnorm peak 0.1;0.06 dynaudnorm peak 2;0.07 dynaudnorm peak -1;0.08 dynaudnorm peak 0/0',dynaudnorm=f=10:g=3", "c21b0cc7261d094865414eb56cfe92594e5fb880d507e542a612c53b1a44a65c"],
    ["asendcmd=c='0 dynaudnorm peak 0.1;0.06 dynaudnorm peak 0.5',dynaudnorm=f=10:g=3", "207336587790f203726b24c0868a4b54e4fc06e901131942371d358c611fe2ff"],
    ["asetnsamples=n=10:p=0,asendcmd=c='0.06 dynaudnorm peak 0.1',dynaudnorm=f=10:g=3", "6588f09e962819140a9e942964a68af63ed4c5ba2342eef72693028ac0c5781c"],
    ["asetnsamples=n=7:p=0,asendcmd=c='0.06 dynaudnorm peak 0.1',dynaudnorm=f=10:g=3", "6588f09e962819140a9e942964a68af63ed4c5ba2342eef72693028ac0c5781c"],
    ["asetpts=PTS+1000,asendcmd=c='1.06 dynaudnorm peak 0.1',dynaudnorm=f=10:g=3", "6588f09e962819140a9e942964a68af63ed4c5ba2342eef72693028ac0c5781c"],
    ["asendcmd=c='0.12 dynaudnorm peak 0.1',dynaudnorm=f=10:g=3", "edd66bebed21c08fa8edd22df980ee19488921dd9a5cfbe84cd3659a2a1fb33a"],
    ["asendcmd=c='0 dynaudnorm peak min',dynaudnorm=f=10:g=3", "4b48f21a4b7a02bfbec19ef880a967a02334a3cdcef8ae83de2ef327ba8bc5dd"]
  ] as const) it(`${filter} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
    const output = await run(filter, graph);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}
