import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const alpha = "00:01.000 --> 00:02.000\nAlpha\n";
const other = "00:01.000 --> 00:02.000\nOther\n";

// Exact output verified against native FFmpeg 7.0.2.
for (const [name, input, cues] of [
  ["identical packets", "[10][20]Alpha\n[10][20]Alpha\n[10][20]Alpha\n", [alpha]],
  ["different dialogue", "[10][20]Alpha\n[10][20]Other\n", [alpha, other]],
  ["different end", "[10][20]Alpha\n[10][21]Alpha\n", [alpha, "00:01.000 --> 00:02.100\nAlpha\n"]],
  ["different start", "[10][20]Alpha\n[11][20]Alpha\n", [alpha, "00:01.100 --> 00:02.000\nAlpha\n"]],
  ["duplicates after sorting", "[10][20]Alpha\n[30][40]Later\n[10][20]Alpha\n", [alpha, "00:03.000 --> 00:04.000\nLater\n"]],
  ["duplicates separated by dialogue", "[10][20]Alpha\n[10][20]Other\n[10][20]Alpha\n", [alpha, other, alpha]],
  ["equivalent timing and line endings", "[010][020]Alpha\r\n[10][20]Alpha\n", [alpha]]
] as const) {
  for (const sync of [false, true]) {
    it(`${sync ? "sync" : "async"} MPL2 to WebVTT handles ${name}`, async () => {
      const volume = Volume.fromJSON({ "/in.txt": input });
      const args = ["-v", "error", "-f", "mpl2", "-i", "/in.txt", "-f", "webvtt", sync ? "/out.vtt" : "pipe:1"];
      let stdout = "";
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, data) => { volume.writeFileSync(path, data); return true; }), "");
        stdout = volume.readFileSync("/out.vtt", "utf8") as string;
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(data: Uint8Array) { stdout += new TextDecoder().decode(data); } },
          stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
      }
      assert.equal(stdout, "WEBVTT\n\n" + cues.join("\n"));
      assert.equal(volume.readFileSync("/in.txt", "utf8"), input);
    });
  }
}
