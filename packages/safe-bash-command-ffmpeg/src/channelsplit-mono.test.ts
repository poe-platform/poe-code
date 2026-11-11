import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 output; the 5.1 control selects FC without remixing.
for (const [layout, count, input, split, expected] of [
  ...([
    ["3.0", 3, "4908b8f7"],
    ["3.0(back)", 3, "64079df8"],
    ["4.0", 4, "8c0975f6"],
    ["5.0", 5, "020bfff4"],
    ["7.1", 8, "0910f8ef"],
    ["6.1", 7, "180ee9f1"],
    ["hexagonal", 6, "990c68f3"],
    ["octagonal", 8, "ff0f02f0"],
    ["7.1(wide)", 8, "2c11d5ee"],
    ["2.1", 3, "dc0525fa"],
    ["mono", 1, "e80319fc"]
  ] as const).map(([layout, count, expected]) => {
    const samples = Buffer.alloc(count * 4);
    for (let channel = 0; channel < count; channel++) {
      samples.writeInt16LE(1000 * (channel + 1), channel * 2);
      samples.writeInt16LE(1 - 1000 * (channel + 1), (count + channel) * 2);
    }
    return [layout, count, samples.toString("hex"), "mono:FC", expected] as const;
  }),
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
      assert.equal(stderr, "");
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
    });
  }
}
