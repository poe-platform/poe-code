import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 hashes include complete frames outside the fade and
// intersecting frames, where nofade preserves samples and exp keeps its residual gain.
for (const [bits, filter, hash] of [
  [16, "afade=t=in:ss=1030:ns=627:c=nofade", "efbd30ae98e58a3df295cc2f637f4f642b7566d782d32a611757391ada358c63"],
  [16, "afade=t=out:ss=1030:ns=627:c=nofade", "575a24be474c035d2ab71af585a3fc4eaa0473cb75ade677b282029b2e9240da"],
  [16, "afade=t=in:ss=0:ns=5000:c=nofade", "d538fd43f1cf91b4b48eb6df3e2527fbc63988e15eedd19befb4eb628af97587"],
  [16, "afade=t=in:ss=1030:ns=627:c=tri", "e4302f20e1ae43a2a418ab9187db645dc4aa9cc626af5cdc2339a25dfa2ae5c2"],
  [32, "aformat=sample_fmts=dbl,afade=t=in:ss=1030:ns=627:c=exp", "0e4da61c4aa3467c8afe5bf7a18529156439c292cd551e3cd3a487498d466e49"],
  [32, "aformat=sample_fmts=dbl,afade=t=in:ss=1030:ns=627:c=tri", "5733b8712fa7c60e396d5ea94c182f3f59ca0e49a5c0840d531bf932ebd1be80"]
] as const) {
  for (const complex of [false, true]) it(`${filter} matches native PCM${bits} frames (${complex ? "complex" : "simple"})`, async () => {
    const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 3173 }, (_, i) => {
        const sample = (i * 179 % 50001) - 25000;
        return bits === 16 ? sample / 32768 : (sample * 65536 + i) / 2147483648;
      })]
    }, { bitsPerSample: bits }));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav",
        ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", `s${bits}le`, "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const output = fs.readFileSync("/out.raw") as Buffer;
    assert.equal(output.length, 3173 * bits / 8);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}

// Frames touching a fade boundary still evaluate the curve; only strictly
// outside frames use the configured silence/unity gains directly.
for (const [type, start, levels] of [
  ["in", 3, [9000, 9000, 9000, 9000]],
  ["in", 4, [9000, 9000, 9000, 9000]],
  ["in", 5, [3000, 9000, 9000, 9000]],
  ["out", 3, [9000, 9000, 3000, 3000]],
  ["out", 4, [9000, 9000, 9000, 3000]],
  ["out", 5, [9000, 9000, 9000, 3000]]
] as const) {
  it(`nofade ${type} at sample ${start} uses frame gains with custom endpoints`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [new Float64Array(16).fill(12000 / 32768)]
    }));
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.wav", "-af", `asetnsamples=4:p=0,afade=t=${type}:ss=${start}:ns=4:c=nofade:silence=0.25:unity=0.75`, "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    } as never);
    assert.equal(result.exitCode, 0);
    const output = fs.readFileSync("/out.raw") as Buffer;
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
      levels.flatMap(level => Array(4).fill(level)));
  });
}
