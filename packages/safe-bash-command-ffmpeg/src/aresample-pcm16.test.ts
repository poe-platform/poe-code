import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: 1536 PCM16 frames at 8000 Hz, sample (i * 421 + c * 1709) % 12000 - 6000.
// Hash the entire raw output to catch single-unit differences in signed samples.
for (const [channels, rate, bytes, hash] of [
  [1, 16000, 6144, "017d80035cefcadffa4ff8847b979c718cb659d28462e9162acafe9c2ed0575a"],
  [2, 16000, 12288, "15f13dae41ab3955aa390b584583c84a123cb77b7745fe7653e9cf1ae3f25eea"],
  [1, 8000, 3072, "e874d3b9256262c88d02c2a123f392fbc90502de73dcca88ad983c1747264c86"],
  [1, 4000, 1536, "dfaa60191385294d66a6c9ee1417a425f8cb9cd55d55018be05b5019c80c2b81"],
  [1, 11025, 4234, "f7cab3d5252ecdde6208e89236d6c2d5de5a732178b88b636864cff8ef383c8a"]
] as const) {
  for (const route of ["filter", "graph", "output"]) it(`matches signed PCM16 for ${channels} channels at ${rate} Hz via ${route}`, async () => {
    const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: Array.from({ length: channels }, (_, c) =>
        Float64Array.from({ length: 1536 }, (_, i) => ((i * 421 + c * 1709) % 12000 - 6000) / 32768)) }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav",
        ...(route === "filter" ? ["-af", `aresample=${rate}`]
          : route === "graph" ? ["-filter_complex", `[0:a]aresample=${rate}[out]`, "-map", "[out]"]
            : ["-ar", String(rate)]), "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = volume.readFileSync("/out.raw") as Buffer;
    assert.equal(output.length, bytes);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}
