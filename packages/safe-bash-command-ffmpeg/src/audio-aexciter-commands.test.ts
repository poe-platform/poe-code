import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, graph = false): Promise<Buffer> {
  const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
  const channels = [
    Float64Array.from({ length: 384 }, (_, i) => (i % 2 ? -10000 : 10000) / 32768),
    Float64Array.from({ length: 384 }, (_, i) => ((i * 53) % 12000 - 6000) / 32768)
  ];
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 48000, channels }));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  const output = fs.readFileSync("/out.raw") as Buffer;
  assert.equal(output.length, 1536);
  return output;
}

// Native FFmpeg 9.0.1 PCM16 hashes; changing parameters must preserve both channels' histories.
for (const [action, value, hash] of [
  ["level_out", "0", "beb5884263788fb0450b762d68f4158e1634725778f55c86640e26b5d03557d6"],
  ["amount", "0", "dce2cdeda70df9ef4146aa090b177198d03a49a11bda97c6054b4a37219cfb6a"],
  ["listen", "1", "4495e43a45d63747c0539556b4c8b75b40d3f4d8ba838cd374f6a0a022341697"],
  ["drive", "1", "94f27f0ca1d5125b3405d575e93c41b761034d1686ced5a0e893c2e1df5f086b"],
  ["level_in", "0.5", "442ba144e1bc7cbf88e7e12f9d1319c52cf2cd4ec6a57538c62b0586aa4ab096"],
  ["blend", "-3", "d038d40458c08281f3822d4b5f13b62e6109d59fa07e8e79053620210568862a"],
  ["freq", "4000", "2a91cc0a6ec7417c44bde26fa95e5af38eee6576211fe2903707d95a9d1e46f4"],
  ["ceil", "12000", "3483b83663e6da20cfcfb2bdb401bb0ba891e705cc660d718742a86bc2574ff4"]
]) for (const graph of [false, true]) {
  it(`updates aexciter ${action} at the receiving frame (${graph ? "graph" : "simple"})`, async () => {
    const output = await run(`asetnsamples=n=96:p=0,asendcmd=c='0.004 aexciter@left ${action} ${value}',aexciter@left`, graph);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}

for (const graph of [false, true]) {
  for (const [time, start] of [[0.003, 192], [0.004, 192], [0.005, 288]]) {
    it(`mutes at sample ${start} for time ${time} (${graph ? "graph" : "simple"})`, async () => {
      const baseline = await run("asetnsamples=96:0,aexciter", graph);
      const output = await run(`asetnsamples=96:0,asendcmd=c='${time} aexciter level_out 0',aexciter`, graph);
      assert.deepEqual(output.subarray(0, start! * 4), baseline.subarray(0, start! * 4));
      assert.deepEqual(output.subarray(start! * 4), Buffer.alloc(output.length - start! * 4));
    });
  }
  it(`routes named and unnamed commands (${graph ? "graph" : "simple"})`, async () => {
    assert.deepEqual(await run("asendcmd=c='0 aexciter@other amount 0',aexciter@left", graph), await run("aexciter", graph));
    assert.deepEqual(await run("asendcmd=c='0 aexciter amount 0',aexciter@left,aexciter@right", graph), await run("aexciter=amount=0,aexciter", graph));
    assert.deepEqual(await run("asendcmd=c='0 aexciter@right amount 0',aexciter@left,aexciter@right", graph), await run("aexciter,aexciter=amount=0", graph));
  });
  it(`keeps valid parameters after rejected commands (${graph ? "graph" : "simple"})`, async () => {
    const expected = await run("asetnsamples=96:0,asendcmd=c='0.006 aexciter level_out 0',aexciter=level_out=0.5", graph);
    for (const command of ["level_out invalid", "level_out 65", "drive 0", "listen 2", "unknown 1"]) {
      assert.deepEqual(await run(`asetnsamples=96:0,asendcmd=c='0 aexciter level_out 1/2;0.003 aexciter ${command};0.006 aexciter level_out 0',aexciter`, graph), expected);
    }
  });
}
