import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 output; the 5.1 control selects FC without remixing.
for (const [layout, count, input, split, expected] of [
  ["stereo", 2, "6400c8009cff38ff", "mono:FC", "96006aff"],
  ["5.1", 6, "6400c8002c019001f40158029cff38ffd4fe70fe0cfea8fd", "mono:FC", "3701c9fe"],
  ["5.1", 6, "6400c8002c019001f40158029cff38ffd4fe70fe0cfea8fd", "5.1:FC", "2c01d4fe"]
] as const) {
  for (const graph of [false, true]) {
    it(`channelsplit ${split} negotiates ${layout} input (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.raw", Buffer.from(input, "hex"));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", String(count),
          "-channel_layout", layout, "-i", "/in.raw", ...(graph
            ? ["-filter_complex", `[0:a]channelsplit=${split}[out]`, "-map", "[out]"]
            : ["-af", `channelsplit=${split}`]), "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
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
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
    });
  }
}
