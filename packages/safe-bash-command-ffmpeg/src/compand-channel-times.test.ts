import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  it(`compand ignores unused channel times and honors warning levels (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({});
    const samples = Float64Array.from({ length: 1600 }, (_, i) => (i % 16 < 8 ? 1 : -1) * (i < 800 ? 0.01 : 0.5));
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples, samples] }));
    const run = async (times: string, level: string) => {
      let stderr = "";
      const filter = `compand=${times}`;
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", level, "-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.pcm"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
      } as never);
      return { ...result, stderr };
    };
    const baseline = await run("attacks=0|1:decays=0|1", "warning");
    assert.equal(baseline.exitCode, 0, baseline.stderr);
    assert.equal(baseline.stderr, "");
    const expected = fs.readFileSync("/out.pcm") as Buffer;
    assert.equal(expected.length, 6400);
    assert.notEqual(expected.readInt16LE(800 * 4), expected.readInt16LE(800 * 4 + 2), "channels retain independent envelopes");
    for (const times of [
      "attacks=0|1|junk:decays=0|1",
      "attacks=0|1:decays=0|1|junk",
      "attacks=0|1|junk:decays=0|1|NaN",
      "attacks=0|1|2:decays=0|1",
      "attacks=0|1:decays=0|1|-1",
      "0|1|junk:0|1"
    ]) for (const level of ["warning", "error", "quiet", "24", "16"]) {
      const result = await run(times, level);
      assert.equal(result.exitCode, 0, `${times}: ${result.stderr}`);
      assert.deepEqual(fs.readFileSync("/out.pcm"), expected, times);
      assert.equal(result.stderr, level === "warning" || level === "24"
        ? "Number of attacks/decays bigger than number of channels. Ignoring rest of entries.\n" : "", `${times}, ${level}`);
    }
    for (const times of ["attacks=0|junk|2:decays=0|1", "attacks=0|1:decays=0|-1|2", "attacks=0:decays=0|1|junk"]) {
      fs.writeFileSync("/out.pcm", "keep");
      const result = await run(times, "warning");
      assert.equal(result.exitCode, 1, times);
      assert.equal(fs.readFileSync("/out.pcm", "utf8"), "keep");
    }
  });
}
