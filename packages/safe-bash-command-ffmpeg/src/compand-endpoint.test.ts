import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/compand-ramp.wav", import.meta.url));

// Native FFmpeg 7.0.2 references for all 4096 PCM16 samples of the 8 kHz ramp.
for (const [endpoint, hash, lastSample] of [
  ["0/-12", "1a2afabc1259643e773ac869d0148ee83a7bfa6c5c30f0b32d1d8c261e608c78", -13044],
  ["1/-12", "0528ac29c9d0bf9d3cf37cd62dac4ffc76627433b3be299f495066844ee7a803", -9605],
  ["0/0", "cf996bcdde011f8924c4d6368c572a1b154e17c2c6cf91395c44451f1ab305d0", -32767],
  ["-1/-12", "5e732536ebbb11d993624798c8fdc781f5cdf608371fc997d58f39586cfa86e6", -32756],
  ["0/-3", "68498a293e7021a4550b4ba98f7ad654fe8e0eb9f0cdf50f1d3a69c83c11be00", -27569],
  ["0/6", "fa7aff8eda0b83950303939f6144f0136a2c6075beb11e68915843ffd2c2bbd7", -32768]
] as const) {
  for (const graph of [false, true]) it(`compand endpoint ${endpoint} matches the native ramp (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({ "/in.wav": input });
    const filter = `compand=attacks=0:decays=0:soft-knee=4:points=-60/-60|${endpoint}`;
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.wav", ...(graph
        ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
        : ["-af", filter]), "-f", "s16le", "/out.pcm"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = fs.readFileSync("/out.pcm") as Buffer;
    assert.equal(output.length, 4096 * 2);
    assert.equal(output.readInt16LE(output.length - 2), lastSample);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}
