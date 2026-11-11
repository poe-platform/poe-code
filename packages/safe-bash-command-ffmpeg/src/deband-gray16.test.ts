import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(format: string, filter: string, graph = false) {
  const input = Buffer.alloc(512);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const value = 24577 + 514 * Math.floor(x / 3) + 257 * Math.floor(y / 4);
      if (format === "gray16le") input.writeUInt16LE(value, (y * 16 + x) * 2);
      else input.writeUInt16BE(value, (y * 16 + x) * 2);
    }
  }
  const volume = Volume.fromJSON({ "/in.raw": input });
  const output: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "error", "-f", "rawvideo", "-pixel_format", format,
      "-video_size", "16x16", "-framerate", "4", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
      "-fps_mode", "passthrough", "-pix_fmt", format, "-bitexact", "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const bytes = Buffer.concat(output);
  assert.equal(bytes.length, input.length);
  return format === "gray16le" ? bytes : bytes.swap16();
}

// Native FFmpeg 7.0.2 full-stream hashes, expressed in little-endian sample order.
for (const format of ["gray16le", "gray16be"]) {
  for (const graph of [false, true]) {
    for (const [filter, hash] of [
      ["null", "b28c1f0f84b2008caa21f4705e63ad4ddb8a63fc45095c3d4ad3f809fd9dd002"],
      ["deband=r=-3:d=-1:1thr=0.1", "8e0294a17aa5d8aeb2d09035a39087416d437c661c556f7e3fa06f12ff00a024"],
      ["deband=r=-3:d=-1:1thr=0.1:blur=0", "8e0294a17aa5d8aeb2d09035a39087416d437c661c556f7e3fa06f12ff00a024"],
      ["deband=r=-3:d=-1:1thr=0.00003", "b28c1f0f84b2008caa21f4705e63ad4ddb8a63fc45095c3d4ad3f809fd9dd002"],
      ["deband=r=-3:d=-1:1thr=0.00198", "ce40e053301a58b6b9d4f71a68d66bfa55905cbce424830407a0ab95adec044c"],
      ["deband=r=-3:d=-1:1thr=0.00199", "33943154cf2412cdac4a7fe020e12e93b5b5c784e1845d19194273da80f61a8e"],
      ["deband=r=-3:d=-1:1thr=0.1,deband=r=-3:d=-1:1thr=0.1", "a7fa75c0b0fd6290b1c1c810c5c1458ef5ccb53cf1b66d917f49275a3a03804f"]
    ] as const) {
      it(`preserves ${format} precision through ${graph ? "graph" : "simple"} ${filter}`, async () => {
        const output = await run(format, filter, graph);
        assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      });
    }
  }
}
