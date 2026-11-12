import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Complete stdout captured from native FFmpeg 7.0.2 with -bitexact.
const cases = [
  { metadata: ["custom=Alpha", "language=eng"],
    expected: "[custom:Alpha]\n[language:eng]\n\n[00:01.00]hello\n" },
  { metadata: ["title=Verse", "artist=Example", "custom=Alpha", "language=eng"],
    expected: "[ti:Verse]\n[ar:Example]\n[custom:Alpha]\n[language:eng]\n\n[00:01.00]hello\n" }
];

for (const sync of [false, true]) {
  for (const { metadata, expected } of cases) {
    it(`${sync ? "sync" : "async"} writes complete LRC output with ${metadata.join(", ")}`, async () => {
      const input = "WEBVTT\n\n00:01.000 --> 00:02.500\nhello\n";
      const volume = Volume.fromJSON({ "/in.vtt": input });
      const args = ["-v", "error", "-i", "/in.vtt", "-bitexact",
        ...metadata.flatMap(tag => ["-metadata", tag]), "-f", "lrc", sync ? "/out.lrc" : "pipe:1"];
      let output = "";
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        output = volume.readFileSync("/out.lrc", "utf8").toString();
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { output += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
      }
      assert.equal(output, expected);
      assert.equal(volume.readFileSync("/in.vtt", "utf8"), input);
    });
  }
}
