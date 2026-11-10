import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// PCM32 hashes from native FFmpeg 7.0.2, including the no-fade and double controls.
for (const [format, fade, expected] of [
  ["flt", true, "668f5ab875917bd9b6323c2237c02b853291e7eb19c44f248ac720ec90ba62d2"],
  ["fltp", true, "668f5ab875917bd9b6323c2237c02b853291e7eb19c44f248ac720ec90ba62d2"],
  ["flt", false, "ace1772d872553bc57f530e21023cce62ce6441d710394f7251a9f0d5cd5ed89"],
  ["dbl", true, "5733b8712fa7c60e396d5ea94c182f3f59ca0e49a5c0840d531bf932ebd1be80"]
] as const) {
  for (const graph of [false, true]) it(`afade preserves ${format} sample precision (fade=${fade}, graph=${graph})`, async () => {
    const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 3173 }, (_, i) => (((i * 179 % 50001) - 25000) * 65536 + i) / 2147483648)]
    }, { bitsPerSample: 32 }));
    const filter = `aformat=sample_fmts=${format},${fade ? "afade=t=in:ss=1030:ns=627:c=tri" : "anull"}`;
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s32le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const output = fs.readFileSync("/out.raw") as Buffer;
    assert.equal(output.length, 12692);
    assert.equal(createHash("sha256").update(output).digest("hex"), expected);
  });
}
