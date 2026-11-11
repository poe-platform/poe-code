import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: nine mono samples with two silent intervals.
const input = Buffer.from("004000000000000000000040000000000000", "hex");

for (const graph of [false, true]) {
  for (const existingOutput of [false, true]) {
    for (const [option, status] of [
      ["n=-1", 222],
      ["d=86401", 222],
      ["m=bad", 234],
      ["foo=1", 8],
      ["n=0.1:d=0.00025:enable=1", 176],
      ["n=0.1:d=0.00025:m=1", 0]
    ] as const) {
      it(`matches native silencedetect status for ${option || "valid options"} (graph=${graph}, existing=${existingOutput})`, async () => {
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.raw", input);
        if (existingOutput) volume.writeFileSync("/out.raw", "keep");
        const filter = `silencedetect=${option}`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
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
          assert.ok(stderr.includes("channel: 0 | silence_start:"), stderr);
          assert.deepEqual(volume.readFileSync("/out.raw"), input);
        } else {
          assert.ok(stderr.includes("silencedetect:"), stderr);
          assert.ok(!stderr.includes("silence_start:"), stderr);
          if (existingOutput) assert.equal(volume.readFileSync("/out.raw", "utf8"), "keep");
          else assert.equal(volume.existsSync("/out.raw"), false);
        }
      });
    }
  }
}
