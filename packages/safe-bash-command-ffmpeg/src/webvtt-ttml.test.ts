import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseXml } from "@poe-code/xml-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [text, pieces] of [
    ["<v Maria>one &amp; <b>two</b>\nthree", ["one & two", "three"]],
    ["hello", ["hello"]],
    ["<i>one</i> <u>two</u> <b>three", ["one two three"]],
    ["&lt;b&gt;literal&lt;/b&gt;", ["<b>literal</b>"]]
  ] as const) {
    it(`${sync ? "sync" : "async"} converts WebVTT markup to TTML: ${text}`, async () => {
      const volume = Volume.fromJSON({
        "/in.vtt": `WEBVTT\n\ncue-1\n00:01.000 --> 00:02.500 align:start position:20%\n${text}\n\n`
      });
      const args = ["-v", "error", "-i", "/in.vtt", "-f", "ttml", sync ? "/out.ttml" : "pipe:1"];
      let output = "";
      if (sync) {
        const result = evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        assert.equal(result, "");
        output = volume.readFileSync("/out.ttml", "utf8").toString();
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
      const root = parseXml(output);
      const span = root.children.find(node => node.localName === "body")!
        .children.find(node => node.localName === "div")!.children[0]!.children[0]!;
      assert.deepEqual(span.content.filter(node => node.kind === "text").map(node => node.text), pieces);
      assert.deepEqual(span.children.map(node => node.localName), pieces.length === 2 ? ["br"] : []);
    });
  }
}
