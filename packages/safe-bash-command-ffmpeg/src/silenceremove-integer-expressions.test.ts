import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [0, 0, 0, 0, 8000, 0, 0, 16000, 8000, 16000, -8000, 0, 0, 0, 0, 0, 0, -16000, 8000, 16000, 0, 0, 0, 0, 8000, -16000, 8000, 16000, 0, 0, 0, 0];

async function run(options: string, complex: boolean) {
  const input = Buffer.alloc(samples.length * 2);
  samples.forEach((value, index) => input.writeInt16LE(value, index * 2));
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  const filter = `silenceremove=window=0:${options}`;
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.raw",
      ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
  return { result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}

// Expected PCM from native FFmpeg 7.0.2, using the same stereo input.
const trimmed = "401f00000000803e401f803ec0e000000000000000000000000080c1401f803e0000000000000000401f80c1401f803e0000000000000000";
for (const complex of [false, true]) {
  for (const [options, hex] of [
    ["start_periods=1+1", "0000803e401f803ec0e000000000000000000000000080c1401f803e0000000000000000401f80c1401f803e0000000000000000"],
    ["start_periods=1:start_mode=any+1", "401f803ec0e000000000000000000000000080c1401f803e0000000000000000401f80c1401f803e0000000000000000"],
    ["start_periods=1:detection=peak-1", trimmed],
    ["start_periods=1:timestamp=copy-1", trimmed],
    ["start_periods=1:stop_periods=-1:stop_mode=all-1", "401f00000000803e401f803e401f803e401f80c1401f803e"],
    ["start_periods=1:stop_periods=0-1:stop_mode=any", "401f00000000803e401f803e401f803e401f80c1401f803e"],
    ["start_periods=3/2", "0000803e401f803ec0e000000000000000000000000080c1401f803e0000000000000000401f80c1401f803e0000000000000000"],
    ["start_periods=1:start_mode=1/2:detection=3/2:timestamp=1/2", trimmed]
  ]) {
    it(`evaluates integer options ${options} (complex=${complex})`, async () => {
      const { result, stderr, output } = await run(options!, complex);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(output.toString("hex"), hex);
    });
  }
  for (const [options, status] of [
    ["start_periods=9000+1", 222],
    ["stop_periods=-9000-1", 222],
    ["start_periods=0-0.1", 222],
    ["start_mode=all+0.1", 222],
    ["stop_mode=any-0.1", 222],
    ["detection=dev+0.1", 222],
    ["timestamp=copy+0.1", 222],
    ["start_periods=1/", 234],
    ["stop_periods=0/0", 234],
    ["start_mode=1/0", 222],
    ["detection=unknown", 234],
    ["timestamp=any", 234],
  ] as const) {
    it(`rejects ${options} without replacing output (complex=${complex})`, async () => {
      const { result, output } = await run(options, complex);
      assert.equal(result.exitCode, status);
      assert.equal(output.toString(), "KEEP");
    });
  }
}
