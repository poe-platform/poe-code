import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const flags of ["min", "max", "default", "slice", "0"]) {
    it(`deesser thread_type=${flags} matches native PCM (graph=${graph})`, async () => {
      const input = Buffer.from(encodeWav({
        sampleRate: 48000,
        channels: [Float64Array.from({ length: 48 }, (_, i) => ((i * 7919) % 50000 - 25000) / 32768)]
      }));
      const fs = Volume.fromJSON({ "/in.wav": input });
      const filter = `deesser=i=1:thread_type=${flags}`;
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const pcm = Buffer.concat(stdout);
      assert.equal(pcm.length, 96);
      // Native FFmpeg 7.0.2 output for the same 48-sample PCM16 WAV.
      assert.equal(createHash("sha256").update(pcm).digest("hex"),
        "e382972aab618c957cfeb90aaf69df0c4c9c134301f4b0dc9f4540f84a5a8d28");
      assert.deepEqual(fs.readFileSync("/in.wav"), input);
    });
  }
}
