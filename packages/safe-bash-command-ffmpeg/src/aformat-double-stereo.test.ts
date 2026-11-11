import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2, f64le mono at 1000 Hz: simultaneous conversion mixes before rounding to float.
const simultaneous = "0000000000000000d7c8b23dd7c8b23d5b4c7abe5b4c7abef6ca0c3ff6ca0c3f";
const separate = "0000000000000000d7c8b23dd7c8b23d5a4c7abe5a4c7abef6ca0c3ff6ca0c3f";
for (const [filter, expected] of [
  ["aformat=channel_layouts=stereo:sample_fmts=flt", simultaneous],
  ["aformat=sample_fmts=flt:channel_layouts=stereo", simultaneous],
  ["aformat=fltp:1000:stereo", simultaneous],
  ["aformat=f=flt:cl=stereo", simultaneous],
  ["aformat=dblp,aformat=f=fltp:cl=stereo", simultaneous],
  ["aformat=sample_fmts=flt,aformat=channel_layouts=stereo", separate],
  ["extrastereo", simultaneous],
  ["stereotools", simultaneous],
  ["aformat=sample_fmts=flt,extrastereo", separate],
  ["stereowiden=drymix=1:crossfeed=0:feedback=0", simultaneous],
  ["stereowiden", "0000000000000000d8c8323dd8c8323d5b4cfabd5b4cfabdf6ca8c3ef6ca8c3e"],
  ["aformat=sample_fmts=flt,stereowiden", "0000000000000000d8c8323dd8c8323d5a4cfabd5a4cfabdf6ca8c3ef6ca8c3e"]
] as const) {
  for (const graph of [false, true]) {
    it(`preserves mono double conversion order for ${filter} (graph=${graph})`, async () => {
      const volume = Volume.fromJSON({});
      const input = Buffer.alloc(32);
      [0, 0.123456789, -0.34567891, 0.77777777].forEach((value, index) => input.writeDoubleLE(value, index * 8));
      volume.writeFileSync("/in.pcm", input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "f64le", "-ar", "1000", "-ac", "1", "-i", "/in.pcm",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "f32le", "/out.pcm"],
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
      assert.equal((volume.readFileSync("/out.pcm") as Buffer).toString("hex"), expected);
    });
  }
}
