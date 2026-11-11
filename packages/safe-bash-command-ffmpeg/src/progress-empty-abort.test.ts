import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 emits this final record even when -abort_on rejects empty output.
const emptyProgress = [
  "bitrate=N/A", "total_size=0", "out_time_us=N/A", "out_time_ms=N/A",
  "out_time=N/A", "dup_frames=0", "drop_frames=0", "speed=N/A", "progress=end", ""
].join("\n");

for (const abort of [undefined, "empty_output", "empty_output_stream"]) {
  for (const target of ["pipe:1", "pipe:2", "/progress.txt"]) {
    it(`reports final empty-output progress to ${target} with ${abort ?? "no abort"}`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.raw", Uint8Array.from({ length: 16 }, (_, i) => i));
      let stdout = "";
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-progress", target, "-f", "s16le", "-ar", "8000", "-ac", "1",
          "-i", "/in.raw", "-t", "0", ...(abort ? ["-abort_on", abort] : []), "-f", "s16le", "/out.bin"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, abort ? 234 : 0, stderr);
      assert.equal(volume.statSync("/out.bin").size, 0);
      if (target === "pipe:1") assert.equal(stdout, emptyProgress);
      else {
        assert.equal(stdout, "");
        if (target === "pipe:2") assert.ok(stderr.includes(emptyProgress), stderr);
        else assert.equal(volume.readFileSync(target, "utf8"), emptyProgress);
      }
      const diagnostic = target === "pipe:2" ? stderr.replace(emptyProgress, "") : stderr;
      if (abort === "empty_output") assert.ok(diagnostic.includes("Nothing was written into output file"), diagnostic);
      else if (abort === "empty_output_stream") assert.ok(diagnostic.includes("Empty output stream"), diagnostic);
      else assert.equal(diagnostic, "");
    });
  }
}
