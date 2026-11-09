import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const [expression, literal] of [
  ["gain=3*2", "gain=6"],
  ["gain=0x6", "gain=6"],
  ["soft-knee=3*2", "soft-knee=6"],
  ["volume=-10*2", "volume=-20"],
  ["delay=1-1", "delay=0"],
  ["attacks=1/2", "attacks=1"],
  ["decays=1/2", "decays=1"],
  ["points=-80/-80|0/1+1", "points=-80/-80|0/1"],
  ["0:0:-80/-80|0/0:3*2:2*3:-10*2:1-1", "0:0:-80/-80|0/0:6:6:-20:0"]
]) for (const graph of [false, true]) {
  it(`compand=${expression} matches its numeric literal (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
      Float64Array.from({ length: 1603 }, (_, i) => (i % 16 < 8 ? 1 : -1) * (i < 800 ? 0.01 : 0.1)),
      Float64Array.from({ length: 1603 }, (_, i) => (i % 8 < 4 ? 1 : -1) * 0.05)
    ] }));
    for (const [name, option] of [["expression", expression], ["literal", literal]]) {
      const filter = `compand=${option}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", `/${name}.pcm`],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
    }
    assert.equal(fs.statSync("/expression.pcm").size, 6412);
    assert.deepEqual(fs.readFileSync("/expression.pcm"), fs.readFileSync("/literal.pcm"));
  });
}

for (const option of [
  "gain=0b1", "gain=0o1", "gain=", "gain=NaN", "gain=1/0", "gain=901", "gain=-901", "gain=450*3",
  "soft-knee=0b1", "soft-knee=1-1", "volume=0b0", "volume=1+1", "delay=0b0", "delay=1+1"
]) for (const graph of [false, true]) {
  it(`compand=${option} preserves existing raw output on failure (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({ "/out.pcm": "sentinel" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.25]), new Float64Array([-0.25])] }));
    const filter = `compand=${option}`;
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.pcm"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    } as never);
    assert.equal(result.exitCode, 1);
    assert.equal(fs.readFileSync("/out.pcm", "utf8"), "sentinel");
  });
}
