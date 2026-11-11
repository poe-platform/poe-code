import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const bypass = "ec744d91c3d7339b7b001447d302af955791ae1d1a2e466bbe2be83c95f57a90";
const normalized = "edd66bebed21c08fa8edd22df980ee19488921dd9a5cfbe84cd3659a2a1fb33a";
const partial = "67014ad223c0b2b1fb5550a0e078c5ef550e76536938b63d62b6efd077a5506b";
// PCM SHA-256 references from native FFmpeg 7.0.2.
for (const graph of [false, true]) for (const [prefix, enable, hash] of [
  ["", "0", bypass], ["", "1", normalized], ["", "lt(t,0.06)", partial],
  ["", "lt(n,6)", partial], ["asetpts=PTS+1000,", "lt(t,1.06)", partial],
  ["", "gte(n,6)", "a0aa4db4d2636975fea64089202a5f7265d0eaad25c117f32fa83ea552a53594"], ["", "isnan(pos)", normalized],
  ["", "lt(st(0,ld(0)+1),7)", partial]
]) {
  it(`dynaudnorm enable=${enable} after ${prefix || "input"} (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({});
    const samples = Float64Array.from({ length: 120 }, (_, i) => (i % 2 ? 1 : -1) * (i < 60 ? 500 : 5000) / 32768);
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 1000, channels: [samples, samples.map(x => 4 * x)] }));
    const filter = `${prefix}dynaudnorm=f=10:g=3:enable='${enable}',ashowinfo`;
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.pcm"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = fs.readFileSync("/out.pcm") as Buffer;
    assert.equal(output.length, 480);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    const frames = stderr.split("\n").filter(line => line.includes("nb_samples:"));
    assert.equal(frames.length, 12);
    for (const [n, line] of frames.entries()) {
      assert.ok(line.includes(`n:${n} pts:${n * 10 + (prefix ? 1000 : 0)} `), line);
      assert.ok(line.includes("nb_samples:10 "), line);
    }
  });
}
