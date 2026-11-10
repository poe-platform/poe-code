import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const complex of [false, true]) {
  for (const [map, existingOutput] of [["0-0|1-0", false], ["0-0|1-0", true], ["0|1", false]] as const) {
    it(`returns native channelmap status (${complex ? "graph" : "simple"}, ${map}, existing output: ${existingOutput})`, async () => {
      const input = Buffer.from("64009cffc80038ff", "hex");
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.raw", input);
      if (existingOutput) volume.writeFileSync("/out.raw", "keep");
      let stderr = "";
      const filters = complex
        ? ["-filter_complex", `[0:a]channelmap=${map}[s]`, "-map", "[s]"]
        : ["-af", `channelmap=${map}`];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...filters, "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (map === "0|1") {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/out.raw"), input);
      } else {
        assert.equal(result.exitCode, 234, stderr);
        assert.equal(stderr, "ffmpeg: channelmap: invalid or duplicate output channel\n");
        if (existingOutput) assert.equal(volume.readFileSync("/out.raw", "utf8"), "keep");
        else assert.equal(volume.existsSync("/out.raw"), false);
      }
    });
  }
}
