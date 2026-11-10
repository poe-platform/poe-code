import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete PCM output from native FFmpeg 7.0.2, mono PCM16 at 8 kHz.
const cases = [
  ...["d 0.01", "duration 0.01", "ns 80", "nb_samples 80"].flatMap(command => [
    ["ns=2800", `0.256 afade@x ${command}`, "609dfe5c2c3261ee5ab360a01c0bfdbf2f4d20112268e507ac05ba0d75a2f63d"],
    ["ss=1600:ns=900", `0.128 afade@x ${command}`, "7ca0efa763a71949ddf042180c30289c3d6d8f0f07e1bd50e13cfa40fe5f7f3f"]
  ]),
  ...["d 10ms", "duration 10000us"].map(command =>
    ["ss=1600:ns=900", `0.128 afade@x ${command}`, "7ca0efa763a71949ddf042180c30289c3d6d8f0f07e1bd50e13cfa40fe5f7f3f"]),
  ...["d 0", "duration 0", "d bad", "duration -0.01"].map(command =>
    ["ss=1600:ns=900", `0.128 afade@x ${command}`, "1d2c5f1bde296e17c657a77c038ef3fdfa7907ace14c1171bc0ed415bebe024a"]),
  ["ss=1600:ns=900", "0.128 afade@x d 1us", "d78688733005299f1337d66d5a9362f04902352f6960efe3fb502e014b1d0ebc"],
  ["ss=1600:ns=900", "0.128 afade@x d 0.01;0.192 afade@x ns 400;0.256 afade@x d 0", "de78134ad421e55405d58c4368a1072b9b2f5d9c732ab82032c6c32d78da16e1"],
  ["ss=1600:ns=900", "0.128 afade@x d 0.01;0.192 afade@x d invalid;0.256 afade@x unity 0.5", "27f47e4be9e964351fc6a6e50b26d39062f396dd201ccc71dfccadea323a0026"]
];

for (const [options, commands, hash] of cases) {
  for (const complex of [false, true]) it(`scheduled afade ${commands} with ${options} matches native PCM (${complex ? "complex" : "simple"})`, async () => {
    const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [new Float64Array(3173).fill(16003 / 32768)] }));
    const filter = `asendcmd=c='${commands}',afade@x=${options}`;
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav",
        ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", "/out.raw"],
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
    assert.equal(output.length, 6346);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}
