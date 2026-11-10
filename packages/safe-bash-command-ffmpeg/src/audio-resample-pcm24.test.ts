import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const wav = encodeWav({ sampleRate: 48000,
  channels: [0, 1].map(channel => Float64Array.from({ length: 1024 }, (_, i) =>
    ((i * 135791 + channel * 42163) % 16000000 - 8000000) / 8388608))
}, { bitsPerSample: 24 });

// Native FFmpeg 7.0.2 output, including every sample of the flushed tail.
for (const [filter, format, length, hash] of [
  ["aresample=44100", "s16le", 3764, "e4cad8f619272dab33b9d180b0d7e6b9bbf02dab49b2d885a0b4fe2761ff44de"],
  ["aresample=44100:osf=s16", "s16le", 3764, "e4cad8f619272dab33b9d180b0d7e6b9bbf02dab49b2d885a0b4fe2761ff44de"],
  ["aresample=44100:osf=s32", "s16le", 3764, "1e26f84e9d44febefc3e76ef70904fecfb08fa679da071cb82259ae7c6ce8056"],
  ["aresample=44100:osf=s32,earwax", "s16le", 3764, "4e462e644f9fbbc9dcdc2300d49aa74aa7b870e3dc3b1d929ec852606f3c2a26"],
  ["aresample=48000", "s16le", 4096, "43ed37c6896c0f3353c4d1f4e359dd31118380918861e909ad0a4370f8538df0"],
  ["aresample=44100,earwax", "s16le", 3764, "da3cdb6ed09266cbf53f54a44c69a39e47a565bcd2b97720c7055dffd7eb33aa"],
  ["earwax", "s16le", 3764, "da3cdb6ed09266cbf53f54a44c69a39e47a565bcd2b97720c7055dffd7eb33aa"],
  ["anull", "s16le", 4096, "43ed37c6896c0f3353c4d1f4e359dd31118380918861e909ad0a4370f8538df0"],
  ["aresample=44100", "s32le", 7528, "0587ec9d62284ef9f84ba7a22b77a6fcb9433a99292248fc0053fec0683c6485"],
  ["aresample=44100", "f32le", 7528, "5996db22324c36532ad3ce6ea21c048f00168d084185c4607a811898c4706c9a"]
] as const) {
  for (const graph of [false, true]) it(`matches native PCM24 resampling with ${filter} to ${format} (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
    fs.writeFileSync("/in.wav", wav);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", format, "/out.raw"],
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
    assert.equal(output.length, length);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}
