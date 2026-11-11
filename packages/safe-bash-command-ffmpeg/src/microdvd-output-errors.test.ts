import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = "WEBVTT\n\ncue-1\n00:01.000 --> 00:02.500 align:start position:20%\nhello\n\n";

for (const { options, format, exitCode, diagnostic } of [
  { options: [], format: "microdvd", exitCode: 234, diagnostic: "Output file does not contain any stream" },
  { options: ["-map", "0:s"], format: "microdvd", exitCode: 8, diagnostic: "Automatic encoder selection failed" },
  { options: ["-c:s", "copy"], format: "microdvd", exitCode: 234, diagnostic: "microdvd muxer supports only codec microdvd for type subtitle" },
  { options: ["-map", "0:s", "-c:s", "copy"], format: "microdvd", exitCode: 234, diagnostic: "microdvd muxer supports only codec microdvd for type subtitle" },
  { options: ["-c:s", "copy"], format: "webvtt", exitCode: 0, diagnostic: "" }
]) {
  it(`returns native status for WebVTT to ${format} with ${options.join(" ") || "automatic selection"}`, async () => {
    const volume = Volume.fromJSON({ "/in.vtt": input });
    let stdout = "";
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "in.vtt", ...options, "-f", format, "pipe:1"],
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
    assert.equal(result.exitCode, exitCode, stderr);
    assert.equal(stdout, exitCode === 0 ? input.slice(0, -1) : "");
    if (diagnostic) assert.ok(stderr.includes(diagnostic), stderr);
    else assert.equal(stderr, "");
    assert.deepEqual(volume.toJSON(), { "/in.vtt": input });
  });
}
