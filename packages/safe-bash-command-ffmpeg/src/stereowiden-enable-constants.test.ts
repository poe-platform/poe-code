import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const input = encodeWav({
  sampleRate: 8000,
  channels: [
    Float64Array.from({ length: 48 }, (_, i) => (i % 8 === 0 ? 10000 : 100) / 32768),
    Float64Array.from({ length: 48 }, (_, i) => (i % 8 === 4 ? -8000 : -200) / 32768)
  ]
});

// Full PCM hashes verified against native FFmpeg 7.0.2.
for (const graph of [false, true]) {
  for (const scheduled of [false, true]) {
    for (const expression of ["PI", "E", "PHI", "1"]) {
      it(`stereowiden enable=${expression}, scheduled=${scheduled}, graph=${graph} matches native PCM`, async () => {
        const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
        const filter = "asetnsamples=n=8:p=0," + (scheduled
          ? `asendcmd=c=0.002 stereowiden enable ${expression},stereowiden=delay=1:enable=0`
          : `stereowiden=delay=1:enable='${expression}'`);
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, 192);
        assert.equal(createHash("sha256").update(output).digest("hex"), scheduled
          ? "54f0edf67bae162972038f3d4fbbbd1688a5da0b61a6f7aa6fbdf52268954fe2"
          : "ac1aa1536a8aa1d178301afabc7311a47e0a2b85449398150ad41665083707d9");
      });
    }
  }
}
