import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: 29 constant PCM16 samples at 8 kHz flush as one 39-sample frame.
for (const [filter, format, checksum] of [
  ["aresample=11025,ashowinfo", "s16", "7C9A1CF2"],
  ["aresample=11025:osf=s16,ashowinfo", "s16", "7C9A1CF2"],
  ["aresample=11025:osf=flt,ashowinfo", "flt", "749167E7"],
  ["aresample=11025,anull,ashowinfo", "s16", "7C9A1CF2"],
  ["aresample=11025,ashowinfo,anull", "s16", "7C9A1CF2"]
] as const) {
  for (const graph of [false, true]) {
    it(`reports the negotiated frame for ${filter} (${graph ? "complex" : "simple"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [new Float64Array(29).fill(16000 / 32768)] }));
      let stderr = "";
      const stdout: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const records = stderr.split("\n").filter(line => line.startsWith("[ashowinfo]"));
      assert.deepEqual(records, [
        `[ashowinfo] n:0 pts:0 pts_time:0 fmt:${format} channels:1 chlayout:mono rate:11025 nb_samples:39 checksum:${checksum} plane_checksums: [ ${checksum} ]`
      ]);
      const expected = Buffer.alloc(39 * 2);
      for (let i = 0; i < 39; i++) expected.writeInt16LE(16000, i * 2);
      assert.deepEqual(Buffer.concat(stdout), expected);
    });
  }
}
