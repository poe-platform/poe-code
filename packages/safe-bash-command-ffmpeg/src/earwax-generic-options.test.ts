import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: eight stereo PCM16 frames at 44100 Hz.
const input = Buffer.from("14ecc8e74feeffe88af036eac5f26deb00f5a4ec3bf7dbed76f912efb1fb49f0", "hex");
const expected = Buffer.from("000000003eff60ff0e006400b8017e0246019d02b801ea03a300ca02f3013a04", "hex");

for (const graph of [false, true]) {
  for (const [option, exitCode] of [
    ["", 0], ["threads=1", 0], ["thread_type=slice", 0], ["extra_hw_frames=1", 0],
    ["threads=1:thread_type=slice:extra_hw_frames=1", 0],
    ["threads=0:thread_type=none:extra_hw_frames=-1", 0],
    ["threads=default:extra_hw_frames=min", 0],
    ["threads=1+1:extra_hw_frames=2-1", 0],
    ["threads=1:", 0],
    ["threads=-1", 222], ["threads=bad", 234], ["threads=", 234],
    ["threads=2147483648", 222], ["thread_type=bad", 234],
    ["thread_type=0.5", 222], ["extra_hw_frames=-2", 222],
    ["extra_hw_frames=bad", 234],
    ["threads=-1:threads=1", 222], ["threads=1::extra_hw_frames=1", 234],
    ["unknown=1", 8], ["threads=1:unknown=1", 8],
    ["enable=0", 176], ["threads=1:enable=0", 176]
  ] as const) {
    it(`earwax ${option || "defaults"} matches native status and bytes (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `earwax${option ? `=${option}` : ""}`;
      const output: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "44100", "-ac", "2", "-ch_layout", "stereo", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, exitCode, stderr);
      assert.deepEqual(Buffer.concat(output), exitCode === 0 ? expected : Buffer.alloc(0));
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
