import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const validOptions = ["", "threads=1", "extra_hw_frames=1",
  "threads=1:extra_hw_frames=1", "threads=0:extra_hw_frames=-1",
  "threads=2147483647:extra_hw_frames=2147483647",
  "threads=default:extra_hw_frames=default", "threads=min:extra_hw_frames=min",
  "threads=max:extra_hw_frames=max", "threads=1+1:extra_hw_frames=min+1",
  "threads=0.5:extra_hw_frames=-0.5"];
const invalidOptions = ["threads=-1", "threads=-0.1", "threads=2147483648",
  "threads=", "threads=bogus", "threads=NaN", "threads=1/0",
  "extra_hw_frames=-2", "extra_hw_frames=-1.1", "extra_hw_frames=2147483648",
  "extra_hw_frames=", "extra_hw_frames=bogus", "extra_hw_frames=NaN",
  "extra_hw_frames=1/0", "unknown=1"];

for (const graph of [false, true]) {
  for (const option of [...validOptions, ...invalidOptions]) {
    it(`compensationdelay handles ${option || "defaults"} (${graph ? "graph" : "simple"})`, async () => {
      const input = encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 128 }, (_, i) => (256 + i) / 32768)]
      }, { bitsPerSample: 16 });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.raw": "KEEP" });
      const filter = `compensationdelay=m=1${option ? `:${option}` : ""}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      const output = volume.readFileSync("/out.raw") as Buffer;
      if (invalidOptions.includes(option)) {
        assert.notEqual(result.exitCode, 0);
        assert.match(stderr, /compensationdelay/);
        assert.equal(output.toString(), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        // Native FFmpeg 7.0.2 delays this input by 23 samples, retaining 128 samples.
        assert.equal(output.length, 256);
        assert.deepEqual(Array.from({ length: 128 }, (_, i) => output.readInt16LE(i * 2)),
          Array.from({ length: 128 }, (_, i) => i < 23 ? 0 : 256 + i - 23));
      }
      assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
    });
  }
}
