import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const first = "A\n00:01.000 --> 00:02.000 align:start\nHello\n";
const other = "00:01.000 --> 00:02.000\nWorld\n";

for (const sync of [false, true]) {
  for (const [name, input, expected] of [
    ["identical packets", [first, first], [first]],
    ["different identifiers", [first, first.replace("A\n", "B\n")], [first]],
    ["different settings", [first, first.replace("align:start", "align:end")], [first]],
    ["different text", [first, other], [first, other]],
    ["separated duplicates", [first, other, first], [first, other, first]],
    ["different end", [first, first.replace("02.000", "03.000")], [first, first.replace("02.000", "03.000")]],
    ["different start", [first, first.replace("01.000", "01.500")], [first, first.replace("01.000", "01.500")]]
  ] as const) {
    it(`${sync ? "sync" : "async"} deduplicates WebVTT packets (${name})`, async () => {
      const volume = Volume.fromJSON({ "/in.vtt": "WEBVTT\n\n" + input.join("\n") });
      const args = ["-v", "error", "-y", "-i", "/in.vtt", ...(sync ? [] : ["-map", "0:s:0"]), "-c:s", "copy", "/out.vtt"];
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
      assert.equal(volume.readFileSync("/out.vtt", "utf8"), "WEBVTT\n\n" + expected.join("\n"));
    });
  }
}
