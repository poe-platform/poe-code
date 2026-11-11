import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const threads of [undefined, "0", "1", "2", "default", "max", "1+1", "-1", "2147483648", "NaN", "", "bogus"]) {
    it(`adecorrelate threads=${threads} (graph=${graph})`, async () => {
      const valid = threads === undefined || ["0", "1", "2", "default", "max", "1+1"].includes(threads);
      const volume = Volume.fromJSON({ "/out.pcm": "keep" });
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 48000, channels: [
        Float64Array.from({ length: 32 }, (_, i) => ((i * 1237) % 30001 - 15000) / 32768),
        Float64Array.from({ length: 32 }, (_, i) => (10000 - (i * 937) % 20001) / 32768)
      ] }));
      const filter = `adecorrelate=seed=42${threads === undefined ? "" : `:threads=${threads}`}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-c:a", "pcm_s16le", "-f", "s16le", "/out.pcm"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (valid) {
        assert.equal(result.exitCode, 0, stderr);
        const pcm = volume.readFileSync("/out.pcm") as Buffer;
        assert.equal(pcm.length, 128);
        // Native FFmpeg 7.0.2 gives identical seeded samples for both thread counts.
        assert.equal(createHash("sha256").update(pcm).digest("hex"), "433ffd7a01407d8506006121a780762fc05dbd08fa0592d6004405683e7d28d3");
      } else {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.readFileSync("/out.pcm", "utf8"), "keep");
      }
    });
  }
}
