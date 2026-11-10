import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 hashes for the retained source timestamp and explicit rebase.
for (const [filter, rebased, firstFrameEnabled] of [
  ["atrim=start_sample=800,afade=t=in:ss=1030:ns=627:c=tri", false, true],
  ["atrim=start_sample=800,asetpts=PTS,afade=t=in:ss=1030:ns=627:c=tri", false, true],
  ["afade=t=in:ss=1030:ns=627:c=tri,atrim=start_sample=800", false, true],
  ["atrim=start_sample=800,asetpts=PTS-STARTPTS,afade=t=in:ss=1030:ns=627:c=tri", true, true],
  ["atrim=start_sample=800,afade=t=in:ss=1030:ns=627:c=tri:enable='gt(n,0)'", false, false]
] as const) {
  for (const complex of [false, true]) it(`${filter} retains native PCM bytes (${complex ? "complex" : "simple"})`, async () => {
    const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 3173 }, (_, i) => ((i * 179 % 50001) - 25000) / 32768)]
    }));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav",
        ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const output = fs.readFileSync("/out.raw") as Buffer;
    assert.equal(output.length, 4746);
    assert.equal(output.readInt16LE(231 * 2), rebased ? 0 : 15);
    if (!firstFrameEnabled) {
      // The first retained WAV frame ends at source sample 1024.
      for (let i = 0; i < 224; i++) {
        assert.equal(output.readInt16LE(i * 2), ((800 + i) * 179 % 50001) - 25000);
      }
      assert.equal(output.readInt16LE(224 * 2), 0);
      output.fill(0, 0, 224 * 2);
    }
    assert.equal(createHash("sha256").update(output).digest("hex"), rebased
      ? "2ba1b72b23cb442731175017d401ffd23efb9b32b618741065c7b6591aebce0a"
      : "6db41f5c4a3778453288afaea7f12e0ddc7f2cd0f89deb1f8cbcefb8215a6aca");
  });
}
