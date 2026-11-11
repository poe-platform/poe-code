import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const bitexact of [false, true]) {
    for (const tags of [false, true]) {
      it(`writes LRC metadata and header separator: sync=${sync}, bitexact=${bitexact}, tags=${tags}`, async () => {
        const input = "WEBVTT\n\ncue-1\n00:01.000 --> 00:02.500 align:start position:20%\nhello\n\n";
        const volume = Volume.fromJSON({ "/in.vtt": input });
        const args = ["-v", "error", "-i", "/in.vtt", ...(bitexact ? ["-bitexact"] : []),
          ...(tags ? ["-metadata", "title=Verse", "-metadata", "artist=Example",
            "-metadata", "album=Book", "-metadata", "author=Writer"] : []),
          "-f", "lrc", sync ? "/out.lrc" : "pipe:1"];
        let stdout = "";
        let stderr = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          stdout = volume.readFileSync("/out.lrc", "utf8") as string;
        } else {
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
        }
        assert.equal(stderr, "");
        assert.equal(stdout, (tags ? "[ti:Verse]\n[ar:Example]\n[al:Book]\n[au:Writer]\n" : "") +
          (bitexact ? "" : "[re:Lavf61.7.100]\n[ve:61.7.100]\n") + "\n[00:01.00]hello\n");
        assert.equal(volume.readFileSync("/in.vtt", "utf8"), input);
      });
    }
  }
}
