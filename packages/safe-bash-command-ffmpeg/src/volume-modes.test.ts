import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Numeric AVOption enum values must select the same processing as named modes.
for (const [numeric, named] of [
  ["0.5:precision=1:eval=0", "0.5"],
  ...["fixed", "float", "double"].flatMap((precision, p) =>
    ["once", "frame"].flatMap((evaluation, e) => [
      [`0.333:precision=${p}:eval=${e}`, `0.333:precision=${precision}:eval=${evaluation}`],
      [`0.333:${p}:${e}`, `0.333:${precision}:${evaluation}`]
    ])),
  ["n/10:precision=1:eval=1", "n/10:precision=float:eval=frame"],
  ["n/10:precision=1+0:eval=1+0", "n/10:precision=float:eval=frame"],
  ["0.333:precision=1/2", "0.333:precision=fixed"],
  ["0.5000000001:precision=3/2", "0.5000000001:precision=double"],
  ["0.333:eval=1/2", "0.333:eval=once"],
  ...["precision=-1", "precision=3", "precision=bogus", "eval=-1", "eval=2", "eval=bogus"]
    .map(option => [`0.5:${option}`, null])
]) {
  it(`handles volume=${numeric}`, async () => {
    const samples = Float64Array.from({ length: 7200 }, (_, i) => (i % 2 ? -12001 : 401) / 32768);
    const fs = Volume.fromJSON({ "/out.wav": "keep" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
    const outputs: number[][] = [];
    for (const expression of named === null ? [numeric] : [numeric, named]) {
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-i", "/in.wav", "-af", `volume=${expression}`, "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
      } as never);
      if (named === null) {
        assert.equal(result.exitCode, numeric!.endsWith("=bogus") ? 234 : 1);
        assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
        return;
      }
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      const actual = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
      outputs.push(Array.from(actual, value => Math.round(value * 32768)));
    }
    assert.deepEqual(outputs[0], outputs[1]);
  });
}
