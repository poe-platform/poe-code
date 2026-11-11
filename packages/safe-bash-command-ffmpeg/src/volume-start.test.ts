import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Starting timestamps stay fixed even when subsequent frames advance.
for (const variable of ["startt", "startpts"]) {
  for (const [prefix, expression, gain] of [
    ["", `${variable}+0.5:eval=frame`, 0.5],
    ["asetpts=PTS+2/TB,", `${variable}/${variable === "startpts" ? 32000 : 4}:eval=frame`, 0.5],
    ["", `${variable}+0.5:eval=once`, null],
    ["", `'if(isnan(${variable}),0.5,1)':eval=once`, 0.5]
  ] as const) {
    it(`matches native PCM for ${prefix}volume=${expression}`, async () => {
      const samples = Float64Array.from([[0, 600], [400, 1600], [12000, 1600], [0, 800], [4000, 1600], [0, 1000]]
        .flatMap(([amplitude, count]) => Array.from({ length: count! }, (_, i) => amplitude! * (i % 2 ? -1 : 1) / 32768)));
      const fs = Volume.fromJSON({ "/out.wav": "keep" });
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-i", "/in.wav", "-af", `${prefix}volume=${expression}`, "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
      } as never);
      if (gain === null) {
        assert.equal(result.exitCode, 1);
        assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
        return;
      }
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      const actual = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
      assert.deepEqual(Array.from(actual, value => Math.round(value * 32768)), Array.from(samples, value => Math.round(value * gain * 32768) || 0));
    });
  }
}

for (const [expression, enabledSamples] of [
  ["1+startpts", [500, 500, 500, 500]],
  ["1+startt*8000", [500, 500, 500, 500]],
  ["n+1", [300, 300, 400, 400]]
] as const) {
  it(`initializes volume timestamps on the first enabled frame for ${expression}`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [new Float64Array(8).fill(100 / 32768)] }));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", "-af",
        `asetnsamples=n=2:p=0,volume=${expression}:eval=frame:enable=gte(n\\,2)`,
        "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const bytes = fs.readFileSync("/out.raw") as Buffer;
    assert.deepEqual(Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2)),
      [100, 100, 100, 100, ...enabledSamples]);
  });
}
