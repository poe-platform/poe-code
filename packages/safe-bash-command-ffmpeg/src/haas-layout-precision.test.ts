import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 references for layout negotiation before Haas.
for (const graph of [false, true]) {
  for (const [count, filter, hash] of [
    [4, "aformat=channel_layouts=stereo,haas", "c75fda3707e308777ed136fbd584990a9a56846d9f08b4c2714e7ef9ac53a9b0"],
    [6, "aformat=channel_layouts=stereo,haas", "d96b3a9d2909e8ed844cdf6f6491be91ae4a849e502224958c1686b50dc83e1c"],
    [4, "aformat=sample_fmts=dbl:channel_layouts=stereo,haas", "c75fda3707e308777ed136fbd584990a9a56846d9f08b4c2714e7ef9ac53a9b0"],
    [4, "aformat=sample_fmts=s16:channel_layouts=stereo,haas", "144f2acbcc732a9d8fd40e2afefe05a7dca638c0155a272447a2a33f72a24991"],
    [4, "aformat=channel_layouts=stereo", "3895f8476c6de1eb5b5bb7dc16d55f7e7259607d9ae4966c924a5a7c2cc1b2fb"]
  ] as const) {
    it(`${count} channels: ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const channels = Array.from({ length: count }, (_, c) =>
        Float64Array.from({ length: 1536 }, (_, i) => ((i * 421 + c * 1709) % 12000 - 6000) / 32768));
      const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
      const pcm = fs.readFileSync("/out.raw") as Buffer;
      assert.equal(pcm.length, 6144);
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    });
  }
}
