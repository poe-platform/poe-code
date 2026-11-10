import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Raw PCM hashes from native FFmpeg 7.0.2, including the unchanged controls.
for (const [count, filter, hash] of [
  [1, "haas", "8522af2b57efd216dd64ad550ddc2bff4b5c38e5817d94a729c71ed34356eaee"],
  [2, "haas", "ec2a6dc16866fc95105c82681d94ccd18a9f775f91dc25b3ad74b4e88305c294"],
  [3, "haas", "ec2a6dc16866fc95105c82681d94ccd18a9f775f91dc25b3ad74b4e88305c294"],
  [4, "haas", "c75fda3707e308777ed136fbd584990a9a56846d9f08b4c2714e7ef9ac53a9b0"],
  [6, "haas", "d96b3a9d2909e8ed844cdf6f6491be91ae4a849e502224958c1686b50dc83e1c"],
  [3, "aformat=channel_layouts=stereo,haas", "ec2a6dc16866fc95105c82681d94ccd18a9f775f91dc25b3ad74b4e88305c294"],
  [6, "anull", "885c656c75531764e2f43dfb7acb40b5093ab99a95e6a5f4bc29b56806912189"],
] as const) for (const graph of [false, true]) {
  it(`${count} channels through ${filter} (${graph ? "graph" : "simple"}) match native PCM`, async () => {
    const channels = Array.from({ length: count }, (_, channel) =>
      Float64Array.from({ length: 1536 }, (_, frame) => ((frame * 421 + channel * 1709) % 12000 - 6000) / 32768));
    const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav", ...(graph
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
    const pcm = volume.readFileSync("/out.raw") as Buffer;
    assert.equal(pcm.length, 1536 * (filter === "anull" ? count : 2) * 2);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}
