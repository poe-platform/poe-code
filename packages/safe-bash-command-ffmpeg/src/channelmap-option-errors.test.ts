import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [expression, exitCode, diagnostic] of [
  ["0|1:bogus=1", 8, "channelmap: unsupported option bogus"],
  ["0|1:enable=1", 176, "channelmap: unsupported option enable"],
  ["0|1", 0, ""]
] as const) {
  for (const complex of [false, true]) {
    for (const existing of [false, true]) {
      it(`reports channelmap option status (${complex ? "graph" : "simple"}, ${existing ? "existing" : "absent"} output): ${expression}`, async () => {
        const volume = new Volume();
        const input = Buffer.from("64009cffc80038ff", "hex");
        volume.writeFileSync("/in.raw", input);
        if (existing) volume.writeFileSync("/out.raw", "keep");
        let stderr = "";
        const filters = complex
          ? ["-filter_complex", `[0:a]channelmap=${expression}[s]`, "-map", "[s]"]
          : ["-af", `channelmap=${expression}`];
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
        assert.equal(result.exitCode, exitCode, stderr);
        assert.equal(stderr, diagnostic ? `ffmpeg: ${diagnostic}\n` : "");
        if (exitCode === 0) assert.deepEqual(volume.readFileSync("/out.raw"), input);
        else if (existing) assert.equal(volume.readFileSync("/out.raw", "utf8"), "keep");
        else assert.equal(volume.existsSync("/out.raw"), false);
      });
    }
  }
}
