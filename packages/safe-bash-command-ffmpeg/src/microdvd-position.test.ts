import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Expected SRT dialogue verified against native FFmpeg.
const cues = [
  ["{o:40,50}Hello", "Hello"],
  ["{P:0}Hello", String.raw`{\an8}Hello`],
  ["{P:1}Hello", "Hello"],
  ["Hello", "Hello"],
  ["{P:0}Hello|world", "{\\an8}Hello\nworld"],
  ["Hello|{P:0}world", "Hello\n{\\an8}world"],
  ["{o:40,50}{P:0}Hello", String.raw`{\an8}Hello`],
  ["{P:0}{P:1}Hello", "Hello"],
  ["Hello{P:0}world", "Hello{P:0}world"],
  ["{p:0}Hello", "{p:0}Hello"],
  ["{P:bad}Hello", "{P:bad}Hello"],
  ["{o:bad}Hello", "{o:bad}Hello"]
];

for (const sync of [false, true]) {
  for (const copy of [false, true]) {
    for (const [cue, expected] of cues) {
      it(`${sync ? "sync" : "async"} ${copy ? "copies" : "decodes"} MicroDVD positioning: ${cue}`, async () => {
        const input = `{1}{1}25\n{25}{50}${cue}\n`;
        const output = copy ? "/out.sub" : "/out.srt";
        const volume = Volume.fromJSON({ "/in.sub": input, [output]: "KEEP" });
        const args = ["-v", "error", "-y", "-f", "microdvd", "-i", "/in.sub",
          "-c:s", copy ? "copy" : "srt", ...(copy ? ["-f", "microdvd"] : []), output];
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
        assert.equal(volume.readFileSync(output, "utf8").toString().replaceAll("\r\n", "\n"), copy
          ? `{25}{50}${cue}\n`
          : `1\n00:00:01,000 --> 00:00:02,000\n${expected}\n\n`);
        assert.equal(volume.readFileSync("/in.sub", "utf8"), input);
      });
    }
  }
}
