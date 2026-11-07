import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const srt = "1\n00:00:01,250 --> 00:00:03,500\nHello\n";

for (const sync of [false, true]) {
  for (const existing of [false, true]) {
    for (const excluded of [false, true]) {
      it(`${sync ? "sync" : "async"} subtitle exclusion=${excluded}, existing output=${existing}`, async () => {
        const volume = Volume.fromJSON({ "/in.srt": srt, ...(existing ? { "/out.vtt": "original" } : {}) });
        const args = ["-y", "-v", "error", "-i", "/in.srt", ...(excluded ? ["-sn"] : []), "/out.vtt"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), excluded ? undefined : "");
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, excluded ? 234 : 0, stderr);
          if (excluded) assert.match(stderr, /Output file does not contain any stream/);
        }
        if (excluded) {
          assert.equal(volume.existsSync("/out.vtt"), existing);
          if (existing) assert.equal(volume.readFileSync("/out.vtt", "utf8"), "original");
        } else {
          assert.equal(volume.readFileSync("/out.vtt", "utf8"), "WEBVTT\n\n00:01.250 --> 00:03.500\nHello\n");
        }
      });
    }
  }
}
