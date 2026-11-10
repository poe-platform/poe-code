import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const format of ["mpl2", "srt"]) {
    it(`${sync ? "sync" : "async"} explicit ${format} input preserves subtitle timing and lines`, async () => {
      const volume = Volume.fromJSON({ "/input.txt": format === "mpl2"
        ? "[12][28]First line|continuation\n[34][50]Last & final\n"
        : "1\n00:00:01,200 --> 00:00:02,800\nFirst line\ncontinuation\n\n2\n00:00:03,400 --> 00:00:05,000\nLast & final\n" });
      const target = "/out.vtt";
      const args = ["-v", "error", "-y", "-f", format, "-i", "/input.txt", target];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
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
        assert.equal(result.exitCode, 0, stderr);
      }
      assert.equal(volume.readFileSync(target, "utf8"),
        "WEBVTT\n\n00:01.200 --> 00:02.800\nFirst line\ncontinuation\n\n00:03.400 --> 00:05.000\nLast & final\n");
    });
  }
}

for (const sync of [false, true]) {
  for (const [dialogue, expected] of [
    ["/First|Second", "<i>First</i>\nSecond"],
    ["First|/Second", "First\n<i>Second</i>"],
    ["First|Second", "First\nSecond"],
    ["/First|/Second", "<i>First</i>\n<i>Second</i>"],
    ["First/part|Second/part", "First/part\nSecond/part"],
    ["/Café|/Żółć", "<i>Café</i>\n<i>Żółć</i>"]
  ]) {
    it(`${sync ? "sync" : "async"} MPL2 to SRT decodes line-level italics: ${dialogue}`, async () => {
      const volume = Volume.fromJSON({ "/input.txt": `[10][20]${dialogue}\n`, "/out.srt": "KEEP" });
      const args = ["-v", "error", "-y", "-f", "mpl2", "-i", "/input.txt", "-c:s", "srt", "/out.srt"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
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
        assert.equal(result.exitCode, 0, stderr);
      }
      assert.equal(volume.readFileSync("/out.srt").toString().replaceAll("\r\n", "\n"),
        `1\n00:00:01,000 --> 00:00:02,000\n${expected}\n\n`);
    });
  }
}
