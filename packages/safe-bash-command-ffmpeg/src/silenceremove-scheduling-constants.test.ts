import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const option of ["thread_type=none", "thread_type=all", "thread_type=default",
  "threads=none", "threads=0", "extra_hw_frames=none", "extra_hw_frames=0",
  "extra_hw_frames=all", "extra_hw_frames=-1", "threads=all+1", "extra_hw_frames=none+all",
  "threads=max", "extra_hw_frames=max", "thread_type=slice", "threads=1", ""]) {
  for (const graph of [false, true]) {
    it(`silenceremove scheduling constant ${option || "control"} preserves native PCM (graph=${graph})`, async () => {
      const input = encodeWav({ sampleRate: 1000, channels: [Float64Array.from(
        [0, 0, 2300, 6400, 0, 0, 0, -4200, 5100, 0, 0, 0, 8200, 0, 0, 0],
        sample => sample / 32768)] });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      const filter = `silenceremove=start_periods=1:window=0${option ? `:${option}` : ""}`;
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      // Complete raw PCM from native FFmpeg 7.0.2 for the same mono WAV.
      assert.equal(Buffer.concat(stdout).toString("hex"),
        "fc08001900000000000098efec130000000000000820000000000000");
      assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
    });
  }
}
