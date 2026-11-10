import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete PCM32 outputs from native FFmpeg 7.0.2, including floating-point and identity controls.
for (const [filter, hash] of [
  ["afade=t=in:ss=1030:ns=627:c=tri", "68cce45ef4975b48bbcd7964d11c2f846e61e3c35390a429581d49346e77da50"],
  ["afade=t=out:ss=1030:ns=627:c=tri", "7a46c384ebd435f6905d960842a7ce9291741d6be06025cc16dc5f1702508f70"],
  ["afade=t=in:ss=1030:ns=627:c=qsin", "8165c8acc213df7f702f89714dfb90e93c1f185985523ece525f212e903eb3e4"],
  ["aformat=sample_fmts=dbl,afade=t=in:ss=1030:ns=627:c=tri", "5733b8712fa7c60e396d5ea94c182f3f59ca0e49a5c0840d531bf932ebd1be80"],
  ["anull", "56883ba9d1e28c079b625f637e3b4bab2430bfadf6ed2236cb1ca701653886f7"]
] as const) {
  for (const graph of [false, true]) it(`preserves native PCM32 fade precision: ${filter} (${graph ? "graph" : "simple"})`, async () => {
    const samples = Float64Array.from({ length: 3173 }, (_, i) => (((i * 179 % 50001) - 25000) * 65536 + i) / 2147483648);
    const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }, { bitsPerSample: 32 }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s32le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = fs.readFileSync("/out.raw") as Buffer;
    assert.equal(output.length, samples.length * 4);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}
