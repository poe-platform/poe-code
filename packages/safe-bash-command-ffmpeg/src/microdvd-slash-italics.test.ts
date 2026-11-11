import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const cues = [
  ["/Hello", "<i>Hello</i>"],
  ["A|/B", "A\n<i>B</i>"],
  ["A/B", "A/B"],
  ["/A|B", "<i>A</i>\nB"],
  ["/A|/B", "<i>A</i>\n<i>B</i>"],
  ["//Hello", "<i>/Hello</i>"]
];

for (const sync of [false, true]) {
  for (const format of ["srt", "webvtt", "microdvd"]) {
    for (const [cue, expected] of cues) {
      it(`${sync ? "sync" : "async"} MicroDVD slash italics to ${format}: ${cue}`, async () => {
        const input = `{1}{1}25\n{25}{50}${cue}\n`;
        const volume = Volume.fromJSON({ "/input.sub": input });
        const args = ["-v", "error", "-f", "microdvd", "-i", "/input.sub",
          ...(format === "microdvd" ? ["-c:s", "copy"] : []),
          "-f", format, sync ? "/output" : "pipe:1"];
        let stdout = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          stdout = volume.readFileSync("/output", "utf8").toString();
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
        }
        assert.equal(stdout, format === "microdvd" ? `{25}{50}${cue}\n`
          : format === "srt" ? `1\n00:00:01,000 --> 00:00:02,000\n${expected!.replaceAll("\n", "\r\n")}\n\n`
          : `WEBVTT\n\n00:01.000 --> 00:02.000\n${expected}\n`);
        assert.equal(volume.readFileSync("/input.sub", "utf8"), input);
      });
    }
  }
}
