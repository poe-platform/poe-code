import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: 1536 four-channel PCM16 frames at 8000 Hz.
for (const [filter, bytes, hash] of [
  ["aformat=sample_fmts=dbl:channel_layouts=stereo,anull", 6144,
    "84e3eabf7b011c130c0f2cf370edaaa3702898d9e5b8cb40dc593d8b22e0a50e"],
  ["aformat=sample_fmts=dbl:channel_layouts=stereo,aformat=sample_fmts=s16", 6144,
    "84e3eabf7b011c130c0f2cf370edaaa3702898d9e5b8cb40dc593d8b22e0a50e"],
  ["aformat=channel_layouts=stereo:sample_fmts=dbl", 6144,
    "84e3eabf7b011c130c0f2cf370edaaa3702898d9e5b8cb40dc593d8b22e0a50e"],
  ["aformat=sample_fmts=dblp:channel_layouts=stereo", 6144,
    "84e3eabf7b011c130c0f2cf370edaaa3702898d9e5b8cb40dc593d8b22e0a50e"],
  ["aformat=sample_fmts=flt,aformat=sample_fmts=dbl:channel_layouts=stereo", 6144,
    "84e3eabf7b011c130c0f2cf370edaaa3702898d9e5b8cb40dc593d8b22e0a50e"],
  ["aformat=sample_fmts=flt:channel_layouts=stereo", 6144,
    "84e3eabf7b011c130c0f2cf370edaaa3702898d9e5b8cb40dc593d8b22e0a50e"],
  ["aformat=sample_fmts=s16:channel_layouts=stereo", 6144,
    "3895f8476c6de1eb5b5bb7dc16d55f7e7259607d9ae4966c924a5a7c2cc1b2fb"],
  ["aformat=sample_fmts=dbl", 12288,
    "d81f3deef22208fab0e857544080fc47970d756ec2b6b2d500a953cab0fc1a77"]
] as const) {
  for (const graph of [false, true]) {
    it(`matches PCM16 rounding for ${filter} (graph=${graph})`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: Array.from({ length: 4 }, (_, c) =>
          Float64Array.from({ length: 1536 }, (_, i) => ((i * 421 + c * 1709) % 12000 - 6000) / 32768)) }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
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
}
