import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Exact PCM hashes from native FFmpeg 7.0.2, including the samples before each command.
for (const [filter, hash] of [
  ["asendcmd=c='0.256 afade@x enable 0',afade@x=ns=2800", "609dfe5c2c3261ee5ab360a01c0bfdbf2f4d20112268e507ac05ba0d75a2f63d"],
  ["asendcmd=c='0.128 afade@x enable 0',afade@x=ss=1600:ns=900", "d22424316da7bb89ca27bdb8bc26c2c93559636fe281a442799d06895bce1eaa"],
  ["asendcmd=c='0.128 afade@x enable 1',afade@x=ss=1600:ns=900", "1d2c5f1bde296e17c657a77c038ef3fdfa7907ace14c1171bc0ed415bebe024a"],
  ["afade@x=ss=1600:ns=900", "1d2c5f1bde296e17c657a77c038ef3fdfa7907ace14c1171bc0ed415bebe024a"],
  ["afade@x=ns=2800", "cde55e80673871b9080ffb4ddaa20ac34c7ef3278711c0d8266d852c1d63ef17"],
  ["asendcmd=c='0.128 afade@x enable unknown',afade@x=ss=1600:ns=900", "1d2c5f1bde296e17c657a77c038ef3fdfa7907ace14c1171bc0ed415bebe024a"],
  ["asendcmd=c='0.128 afade@x enable 0;0.256 afade@x enable unknown',afade@x=ss=1600:ns=900", "d22424316da7bb89ca27bdb8bc26c2c93559636fe281a442799d06895bce1eaa"]
]) {
  for (const complex of [false, true]) it(`scheduled enable: ${filter} (${complex ? "complex" : "simple"})`, async () => {
    const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [new Float64Array(3173).fill(16003 / 32768)] }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.wav", ...(complex
        ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
