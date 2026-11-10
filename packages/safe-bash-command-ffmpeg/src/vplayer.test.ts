import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const vplayer = "0:00:01:First|line\n0:00:03:Second\n0:00:06:\n";
const expected = "1\n00:00:01,000 --> 00:00:03,000\nFirst\nline\n\n2\n00:00:03,000 --> 00:00:06,000\nSecond\n\n";
for (const sync of [false, true]) {
  for (const forced of [false, true]) {
    for (const { name, format, input, output } of [
      { name: "vplayer", format: "vplayer", input: vplayer, output: expected },
      { name: "srt", format: "srt", input: expected, output: expected },
      ...[":", " ", "="].map(separator => ({
        name: `vplayer with ${JSON.stringify(separator)} separator`,
        format: "vplayer",
        input: `0:00:01${separator}First|Second\n0:00:04:\n`,
        // Native FFmpeg 7.0.2 output, with CRLF normalized to LF.
        output: "1\n00:00:01,000 --> 00:00:04,000\nFirst\nSecond\n\n"
      }))
    ]) {
      it(`${sync ? "sync" : "async"} ${forced ? "forced" : "detected"} ${name} preserves timing and lines`, async () => {
        const volume = Volume.fromJSON({ "/end.txt": input, "/out.srt": "KEEP" });
        const args = ["-v", "error", "-y", ...(forced ? ["-f", format] : []), "-i", "/end.txt", "-c:s", "srt", "/out.srt"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, data) => { volume.writeFileSync(path, data); return true; }), "");
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
        }
        assert.equal(String(volume.readFileSync("/out.srt")).replaceAll("\r\n", "\n"), output);
      });
    }
  }
}
