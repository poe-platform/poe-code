import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [101, 102, 103, 104, 105, 106, 107, 108];
const input = Buffer.alloc(samples.length * 2);
samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));

// Exact PCM output from native FFmpeg 7.0.2, including overlapping input frames.
for (const graph of [false, true]) {
  for (const [pts, padding, options, retained, silence] of [
    ["PTS/2", "", ["-t", "0.002"], samples, 11],
    ["PTS/2", "", ["-ss", "0.0005", "-t", "0.0015"], [108], 11],
    ["PTS/2", "", ["-to", "0.002"], samples, 11],
    ["PTS/2", ":pad_len=100", ["-t", "0.002"], samples, 11],
    ["PTS/2", ":pad_len=100", ["-ss", "0.0005", "-t", "0.0015"], [108], 11],
    ["PTS*2", "", ["-t", "0.002"], samples, 2]
  ] as const) {
    const filter = `asetnsamples=n=3:p=0,asetpts=${pts},apad=packet_size=2${padding}`;
    it(`${filter} pads through ${options.join(" ")} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          ...options, "-f", "s16le", "/out.raw"],
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
      const expected = Buffer.alloc((retained.length + silence) * 2);
      retained.forEach((sample, index) => expected.writeInt16LE(sample, index * 2));
      assert.deepEqual(volume.readFileSync("/out.raw"), expected);
    });
  }
}
