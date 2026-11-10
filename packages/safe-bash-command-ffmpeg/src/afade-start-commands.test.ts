import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete PCM output from native FFmpeg 7.0.2, including samples before the command.
for (const [filter, hash] of [
  ["asendcmd=c='0.256 afade@x ss 2200',afade@x=ns=2800", "5ad375559d48e3b9690bea99a25f8d0dc682f34cf787933d49cb3831b27a383b"],
  ["asendcmd=c='0.256 afade@x st 0.275',afade@x=ns=2800", "5ad375559d48e3b9690bea99a25f8d0dc682f34cf787933d49cb3831b27a383b"],
  ["asendcmd=c='0.128 afade@x start_sample 2200',afade@x=ss=1600:ns=900", "ad02be8e7b48755bae34230c76b97cc785e2371c7a99bbda61036d5fffab6b49"],
  ["asendcmd=c='0.128 afade@x start_time 0.275',afade@x=ss=1600:ns=900", "ad02be8e7b48755bae34230c76b97cc785e2371c7a99bbda61036d5fffab6b49"],
  ["afade@x=ns=2800", "cde55e80673871b9080ffb4ddaa20ac34c7ef3278711c0d8266d852c1d63ef17"],
  ["afade@x=ss=2200:ns=900", "ad02be8e7b48755bae34230c76b97cc785e2371c7a99bbda61036d5fffab6b49"],
  ...["ss -1", "start_sample invalid", "st -1", "start_time invalid"].map(command =>
    [`asendcmd=c='0.256 afade@x ${command}',afade@x=ns=2800`, "cde55e80673871b9080ffb4ddaa20ac34c7ef3278711c0d8266d852c1d63ef17"])
]) {
  for (const complex of [false, true]) it(`scheduled afade ${filter} matches native PCM (${complex ? "complex" : "simple"})`, async () => {
    const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [new Float64Array(3173).fill(16003 / 32768)]
    }));
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
