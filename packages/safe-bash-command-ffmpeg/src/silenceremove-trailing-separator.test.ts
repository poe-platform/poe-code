import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [0, 0, 0, 0, 8000, 0, 0, 16000, 8000, 16000, -8000, 0, 0, 0, 0, 0,
  0, -16000, 8000, 16000, 0, 0, 0, 0, 8000, -16000, 8000, 16000, 0, 0, 0, 0];

async function run(filter: string, complex: boolean, existing = false) {
  const input = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
  const volume = Volume.fromJSON({ "/in.raw": input, ...(existing ? { "/out.raw": "KEEP" } : {}) });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.raw",
      ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, volume };
}

for (const complex of [false, true]) {
  for (const options of ["start_periods=1:window=0", "start_periods=1:window=0:", "1:window=0:"]) {
    it(`silenceremove accepts ${options} with native PCM (complex=${complex})`, async () => {
      const { result, stderr, volume } = await run(`silenceremove=${options}`, complex);
      assert.equal(result.exitCode, 0, stderr);
      // Native FFmpeg 7.0.2: the separator does not change the retained stereo samples.
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"),
        "401f00000000803e401f803ec0e000000000000000000000000080c1401f803e0000000000000000401f80c1401f803e0000000000000000");
    });
  }
  for (const options of ["start_periods=1:window=0::", "start_periods=1::window=0", "start_periods=1:window=:"]) {
    it(`silenceremove rejects empty options in ${options} preserving output (complex=${complex})`, async () => {
      const { result, stderr, volume } = await run(`silenceremove=${options}`, complex, true);
      assert.notEqual(result.exitCode, 0, stderr);
      assert.equal(volume.readFileSync("/out.raw").toString(), "KEEP");
    });
  }
}
