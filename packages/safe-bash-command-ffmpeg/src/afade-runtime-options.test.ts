import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete PCM output from native FFmpeg 7.0.2, including samples before the command.
for (const [command, hash] of [
  ["curve qsin", "1db934603252e94a987f886cf3db30d263b703a9ebbde885903285ba03dd9825"],
  ["curve default+1", "1db934603252e94a987f886cf3db30d263b703a9ebbde885903285ba03dd9825"],
  ["c 1", "1db934603252e94a987f886cf3db30d263b703a9ebbde885903285ba03dd9825"],
  ["silence 0.5", "33d80cd15d46eac2fda20f17a65d8162f103336e12ee8660b37063fbf35421fa"],
  ["ns 50", "9bb9434d532d5ba5f75676961e27feb9eebff8cb5f488c63bdfa7dc208fae762"],
  ["nb_samples min+49", "9bb9434d532d5ba5f75676961e27feb9eebff8cb5f488c63bdfa7dc208fae762"],
  ["nb_samples 50", "9bb9434d532d5ba5f75676961e27feb9eebff8cb5f488c63bdfa7dc208fae762"],
  ["t out", "3f435f052204ef472bd163846dacf1e7e76eeb38b6ba0f946943e689e1895c69"],
  ["t max", "3f435f052204ef472bd163846dacf1e7e76eeb38b6ba0f946943e689e1895c69"],
  ["type 1", "3f435f052204ef472bd163846dacf1e7e76eeb38b6ba0f946943e689e1895c69"],
  ["unity default/2", "0b2e6eaf3170cfe01e2130c960a11ab3f8889e647658d622a67ef8dc191f6e4e"],
  ["unity 0.5", "0b2e6eaf3170cfe01e2130c960a11ab3f8889e647658d622a67ef8dc191f6e4e"],
  ["", "fbe469005bff8dd1c27db0d3b6d59059764d5ba6dc8c6d149fd9114630b5a1e1"],
  ...["curve invalid", "silence 2", "ns 0", "t invalid"].map(command =>
    [command, "fbe469005bff8dd1c27db0d3b6d59059764d5ba6dc8c6d149fd9114630b5a1e1"])
]) {
  for (const complex of [false, true]) it(`scheduled afade ${command || "control"} matches native PCM (${complex ? "complex" : "simple"})`, async () => {
    const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 3173 }, (_, i) => ((i * 179 % 50001) - 25000) / 32768)]
    }));
    const filter = `${command ? `asendcmd=c='0.128 afade@x ${command}',` : ""}afade@x=ss=1600:ns=900`;
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
