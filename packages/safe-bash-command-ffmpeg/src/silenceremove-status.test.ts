import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2, stereo s16le at 1000 Hz.
const input = Buffer.alloc(64);
[0, 0, 0, 0, 8000, 0, 0, 16000, 8000, 16000, -8000, 0, 0, 0, 0, 0,
  0, -16000, 8000, 16000, 0, 0, 0, 0, 8000, -16000, 8000, 16000, 0, 0, 0, 0]
  .forEach((sample, index) => input.writeInt16LE(sample, index * 2));

for (const graph of [false, true]) {
  for (const existingOutput of [false, true]) {
    for (const [option, status] of [
      ["unknown=1", 8],
      ["stop_mode=neither", 234],
      ["start_periods=bad", 234],
      ["window=bad", 234],
      ["start_threshold=nan", 234],
      ["enable=bad", 234],
      ["window=101", 222],
      ["window=-1", 222],
      ["start_periods=9001", 222],
      ["stop_periods=-9001", 222],
      ["start_threshold=-1", 222],
      ["start_threshold=inf", 222],
      ["stop_mode=2", 222],
      ["detection=6", 222],
      ["timestamp=2", 222],
      ["threads=-1", 222],
      ["thread_type=0.5", 222],
      ["", 0]
    ] as const) {
      it(`matches native silenceremove status for ${option || "valid options"} (graph=${graph}, existing=${existingOutput})`, async () => {
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.raw", input);
        if (existingOutput) volume.writeFileSync("/out.raw", "keep");
        const filter = `silenceremove=start_periods=1:window=0${option ? `:${option}` : ""}`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
        assert.equal(result.exitCode, status, stderr);
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
        if (status === 0) {
          assert.equal(stderr, "");
          assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"),
            "401f00000000803e401f803ec0e000000000000000000000000080c1401f803e0000000000000000401f80c1401f803e0000000000000000");
        } else {
          assert.match(stderr, /silenceremove/);
          if (existingOutput) assert.equal(volume.readFileSync("/out.raw", "utf8"), "keep");
          else assert.equal(volume.existsSync("/out.raw"), false);
        }
      });
    }
  }
}
