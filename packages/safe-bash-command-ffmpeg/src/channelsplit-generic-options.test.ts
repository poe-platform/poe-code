import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const option of ["", "threads=1", "thread_type=slice", "extra_hw_frames=1",
    "threads=0:thread_type=none+slice:extra_hw_frames=-1", "thread_type=all-slice",
    "threads=default:extra_hw_frames=min", "threads=-1", "extra_hw_frames=-2",
    "threads=2147483648", "thread_type=4294967296", "thread_type=0.5", "thread_type=bogus"]) {
    it(`channelsplit accepts scheduling options: ${option || "control"} (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.from("6400c8009cff38ff", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `channelsplit=stereo:FL${option ? `:${option}` : ""}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-channel_layout", "stereo", "-i", "/in.raw",
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
      if (["threads=-1", "extra_hw_frames=-2", "threads=2147483648", "thread_type=4294967296",
        "thread_type=0.5", "thread_type=bogus"].includes(option)) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.existsSync("/out.raw"), false);
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(volume.readFileSync("/out.raw").toString("hex"), "64009cff");
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
