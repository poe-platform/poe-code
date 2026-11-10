import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Full PCM hashes from native FFmpeg 7.0.2, using the same 48-frame WAV.
const bypass = "845dd3d815c0887c5b2f9b2f35e7dafac71faaf38f2b82ab69aeb115261afb58";
const widened = "ac1aa1536a8aa1d178301afabc7311a47e0a2b85449398150ad41665083707d9";
const scheduled = "54f0edf67bae162972038f3d4fbbbd1688a5da0b61a6f7aa6fbdf52268954fe2";
for (const graph of [false, true]) {
  for (const [filter, hash] of [
    ...[["eq(pos,44)", widened], ["1", widened], ["eq(pos,45)", bypass], ["0", bypass]].map(([enable, hash]) =>
      [`asetnsamples=n=8:p=0,stereowiden=delay=1:enable='${enable}'`, hash]),
    ...["w", "h", "0"].map(enable => [`stereowiden=enable=${enable}`, bypass]),
    ...["pos", "1"].map(enable =>
      [`asetnsamples=n=8:p=0,asendcmd=c=0.002 stereowiden enable ${enable},stereowiden=delay=1:enable=0`, scheduled])
  ]) {
    it(`matches native frame variables: ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const channels = [
        Float64Array.from({ length: 48 }, (_, i) => (i % 8 === 0 ? 10000 : 100) / 32768),
        Float64Array.from({ length: 48 }, (_, i) => (i % 8 === 4 ? -8000 : -200) / 32768)
      ];
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels })) });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
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
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}
