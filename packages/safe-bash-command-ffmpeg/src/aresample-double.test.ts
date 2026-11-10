import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg PCM16 hashes for stereo 8 kHz input resampled to 16 kHz.
for (const [filter, hash] of [
  ["aformat=dblp,aresample=16000", "42b3f09f4c723375"],
  ["aformat=fltp,aresample=16000", "593ea20a54bf414d"],
  ["flanger,aresample=16000", "98b8b55ebb2568be"],
  ["aresample=16000,flanger", "7de72fc85162b3f5"],
  ["flanger,aformat=s16,aresample=16000", "ee75932618ac649e"]
] as const) {
  for (const graph of [false, true]) it(`preserves resampling precision for ${filter} (${graph ? "graph" : "simple"})`, async () => {
    const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [0, 1].map(channel => Float64Array.from({ length: 8000 }, (_, i) =>
        ((i * 997 + channel * 149) % 60001 - 30000) / 32768)) }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.wav",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", "/out.pcm"],
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
    const output = volume.readFileSync("/out.pcm") as Buffer;
    assert.equal(output.length, 64000);
    assert.equal(createHash("sha256").update(output).digest("hex").slice(0, 16), hash);
  });
}
