import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const positions = [999, 1000, 1500, 2000, 2999, 3000];
for (const [filter, indices, expected] of [
  ["afade=t=in:ss=1000:ns=2000", positions, [0, 0, 3000, 6000, 11994, 12000]],
  ["afade=t=in:ss=1000:ns=2000:curve=qua", positions, [0, 0, 750, 3000, 11988, 12000]],
  ["afade=t=out:st=0.125:d=0.25", positions, [12000, 12000, 9000, 6000, 6, 0]],
  ["afade=type=in:start_time=0.125:duration=0.25", positions, [0, 0, 3000, 6000, 11994, 12000]],
  ["afade=in:1000:2000", positions, [0, 0, 3000, 6000, 11994, 12000]],
  ["afade=t=in:ss=0:ns=4:silence=0.25:unity=0.75", [0, 1, 2, 3, 4, 5], [3000, 4500, 6000, 7500, 9000, 9000]],
  ["afade=t=out:ns=4:silence=0.25:unity=0.75", [0, 1, 2, 3, 4, 5], [9000, 7500, 6000, 4500, 3000, 3000]],
  ["afade=ns=4,volume=0.5", [0, 1, 2, 3, 4], [0, 1500, 3000, 4500, 6000]],
  ["afade=t=in:d=1us", [0, 1, 2, 3], [0, 12000, 12000, 12000]],
  ["afade=t=in:d=62us", [0, 1, 2, 3], [0, 12000, 12000, 12000]],
  ["afade=t=out:d=1us", [0, 1, 2, 3], [0, 0, 0, 0]],
  ["afade=t=out:d=62us", [0, 1, 2, 3], [0, 0, 0, 0]],
  ["afade=t=in:d=63us", [0, 1, 2, 3], [0, 12000, 12000, 12000]],
  ["afade=t=out:d=63us", [0, 1, 2, 3], [12000, 0, 0, 0]],
  ["afade=t=in:ss=2:d=1us", [0, 1, 2, 3], [0, 0, 0, 12000]],
  ["afade=t=out:ss=2:d=1us", [0, 1, 2, 3], [12000, 12000, 0, 0]],
  ["asetpts=PTS+8,afade=ns=4", [0, 1, 2, 3, 4], [12000, 12000, 12000, 12000, 12000]],
  ["asetpts=PTS+2,afade=ns=4", [0, 1, 2, 3, 4], [6000, 9000, 12000, 12000, 12000]],
  ["asetpts=PTS-2,afade=ns=4", [0, 1, 2, 3, 4, 6], [0, 0, 0, 3000, 6000, 12000]],
  ["asetpts=PTS+2,afade=t=out:d=0.0005", [0, 1, 2, 3, 4], [6000, 3000, 0, 0, 0]],
  ["asetnsamples=2:0,asetpts=2*PTS,afade=ns=8", [0, 1, 2, 3, 4], [0, 1500, 6000, 7500, 12000]],
  ["asetnsamples=2:0,asetpts=0,afade=ns=4", [0, 1, 2, 3, 4], [0, 3000, 0, 3000, 0]],
  ["asetpts=PTS+8,asetpts=PTS-STARTPTS,afade=ns=4", [0, 1, 2, 3, 4], [0, 3000, 6000, 9000, 12000]],
  ["afade=type=0:start_sample=1000:nb_samples=2000:c=6", positions, [0, 0, 750, 3000, 11988, 12000]],
  ["afade=ss=2:ns=4:st=125ms:d=250ms", positions, [0, 0, 3000, 6000, 11994, 12000]],
  ["afade", [0, 2205, 4410], [0, 600, 1200]]
] as const) {
  for (const graph of [false, true]) it(`${filter} (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
      new Float64Array(8000).fill(12000 / 32768), new Float64Array(8000).fill(-12000 / 32768)
    ] }));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    for (const [c, channel] of audio.channelData.entries()) {
      assert.equal(channel.length, 8000);
      indices.forEach((position, i) => assert.ok(Math.abs(channel[position]! * 32768 - expected[i]! * (c ? -1 : 1)) <= 1,
        `channel ${c}, sample ${position}: ${channel[position]! * 32768}`));
    }
  });
}

for (const filter of ["afade=ns=0", "afade=ns=0:d=1us", "afade=ss=-1", "afade=ns=0.9", "afade=ss=-0.1", "afade=st=bad",
  "afade=d=Infinity", "afade=t=bad", "afade=curve=bad", "afade=unity=1.1",
  "afade=silence=-0.1", "afade=ns=", "afade=unknown=1", "afade=ns=9007199254740992"]) {
  it(`${filter} fails without replacing output`, async () => {
    const fs = Volume.fromJSON({ "/out.wav": "keep" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.25])] }));
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/in.wav", "-af", filter, "/out.wav"], cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    } as never);
    assert.equal(result.exitCode, 1);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
  });
}
