import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 10 }, (_, index) => (index + 1) * 1000);
const input = Buffer.alloc(samples.length * 2);
samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));

// Native FFmpeg 7.0.2 PCM output: the cap counts frames retained after output seeking.
for (const graph of [false, true]) {
  for (const [padding, seek, expected] of [
    ["", "0.012", Array(8).fill(0)],
    ["", "0.006", [...samples.slice(6), 0, 0, 0, 0]],
    ["", "0.007", [...samples.slice(7), 0, 0, 0, 0]],
    ["", "0.010", Array(8).fill(0)],
    ["", "0.011", Array(7).fill(0)],
    [":pad_len=12", "0.012", Array(8).fill(0)],
    ["", undefined, samples]
  ] as const) {
    it(`apad${padding} counts four frames after seek ${seek ?? "unset"} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input });
      const chunks: Buffer[] = [];
      let stderr = "";
      const filter = `asetnsamples=n=3:p=0,apad=packet_size=2${padding}`;
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          ...(seek === undefined ? [] : ["-ss", seek]), "-frames:a", "4", "-f", "s16le", "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = Buffer.concat(chunks);
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)), expected);
    });
  }
}
