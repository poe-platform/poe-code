import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7.0.2 removes only initial ASCII spaces when re-encoding WebVTT.
const cases = [
  ["  First", "First"],
  ["  First  \n  Last  ", "First  \n  Last  "],
  ["\tFirst\t", "\tFirst\t"],
  ["  \tFirst  ", "\tFirst  "],
  ["\t  First  ", "\t  First  "]
] as const;

for (const mode of ["sync", "file", "pipe"] as const) {
  for (const copy of [false, true]) {
    for (const [text, encoded] of cases) {
      it(`${mode} ${copy ? "copies" : "re-encodes"} WebVTT whitespace ${JSON.stringify(text)}`, async () => {
        const header = "WEBVTT\n\n00:01.250 --> 00:03.500\n";
        const volume = Volume.fromJSON({ "/in.vtt": `${header}${text}\n\n` });
        const target = mode === "pipe" ? "pipe:1" : "/out.vtt";
        const args = ["-v", "error", "-i", "/in.vtt", ...(copy ? ["-c:s", "copy"] : []),
          "-f", "webvtt", target];
        let stdout = "";
        if (mode === "sync") {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(data: Uint8Array) { stdout += new TextDecoder().decode(data); } },
            stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
        }
        const expected = `${header}${copy ? text : encoded}\n`;
        assert.equal(stdout, mode === "pipe" ? expected : "");
        if (mode !== "pipe") assert.equal(volume.readFileSync(target, "utf8"), expected);
      });
    }
  }
}

for (const settings of ["position:30%  ", "align:end\t", "position:30%", "line:2\talign:end"]) {
  it(`preserves copied WebVTT settings ${JSON.stringify(settings)} on stdout`, async () => {
    const expected = `WEBVTT\n\ncue-1\n00:01.250 --> 00:03.500 ${settings}\nHi\n`;
    const volume = Volume.fromJSON({ "/in.vtt": expected + "\n" });
    let stdout = "";
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.vtt", "-c:s", "copy", "-f", "webvtt", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(data: Uint8Array) { stdout += new TextDecoder().decode(data); } },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stdout, expected);
  });
}
