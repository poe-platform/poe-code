import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const srt = "1\n00:00:01,250 --> 00:00:03,500\nHello\n\n2\n00:00:05,000 --> 00:00:06,750\nthere\n";
const vtt = "WEBVTT\n\n00:00:01.250 --> 00:00:03.500\nHello\n\n00:00:05.000 --> 00:00:06.750\nthere\n";

for (const sync of [false, true]) {
  for (const [input, output, valid] of [
    ["srt", "vtt", false], ["vtt", "srt", false],
    ["mp4", "vtt", false], ["mp4", "srt", false],
    ["srt", "srt", true], ["vtt", "vtt", true]
  ] as const) {
    for (const forced of [false, true]) {
      it(`${sync ? "sync" : "async"} subtitle copy ${input} -> ${output}, forced=${forced}`, async () => {
        const volume = Volume.fromJSON({ "/in.srt": srt, "/in.vtt": vtt });
        const read = (path: string) => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined;
        const write = (path: string, bytes: Uint8Array) => { volume.writeFileSync(path, bytes); return true; };
        if (input === "mp4") {
          assert.equal(evalSyncFfmpeg(["-i", "/in.srt", "-c:s", "mov_text", "/in.mp4"], undefined, read, write), "");
        }
        const target = forced ? "/out.data" : `/out.${output}`;
        const args = ["-y", "-v", "error", "-i", `/in.${input}`, "-c:s", "copy",
          ...(forced ? ["-f", output === "vtt" ? "webvtt" : "srt"] : []), target];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, read, write), valid ? "" : undefined);
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { write(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          if (valid) assert.equal(result.exitCode, 0, stderr);
          else {
            assert.notEqual(result.exitCode, 0);
            assert.match(stderr, /copy subtitle codec/i);
          }
        }
        if (valid) assert.equal(volume.readFileSync(target, "utf8"), output === "srt" ? srt : vtt);
        else assert.equal(volume.existsSync(target), false);
      });
    }
  }
}
