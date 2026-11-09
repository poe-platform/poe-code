import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [filter, expected] of [
  ["afade=ns=4096:enable=gt(n\\,0)", [1000, 1000, 125, 249, 250, 499, 500, 999]],
  ["afade=ns=4096:enable=0", Array(8).fill(1000)],
  ["afade=ns=4096:enable=1", [0, 124, 125, 249, 250, 499, 500, 999]],
  ["afade=ns=4096:enable='gte(t,0.064)'", [1000, 1000, 125, 249, 250, 499, 500, 999]],
  ["asetnsamples=1024:0,afade=ns=4096:enable='gt(n,0)'", [1000, 1000, 1000, 1000, 250, 499, 500, 999]],
  ["asetpts=PTS+512,afade=ns=4096:enable='gte(t,0.128)'", [1000, 1000, 250, 374, 375, 624, 625, 1000]]
] as const) {
  for (const graph of [false, true]) it(`${filter} enables whole input frames (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array(4096).fill(1000 / 32768)] }));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const samples = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.equal(samples.length, 4096);
    assert.deepEqual([0, 511, 512, 1023, 1024, 2047, 2048, 4095].map(i => samples[i]! * 32768), expected);
  });
}

for (const enable of ["", "unknown", "gt(n,)"]) {
  it(`rejects invalid enable=${enable} without replacing output`, async () => {
    const fs = Volume.fromJSON({ "/out.wav": "keep" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array(512)] }));
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/in.wav", "-af", `afade=enable='${enable}'`, "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    } as never);
    assert.equal(result.exitCode, 1);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
  });
}
