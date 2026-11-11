import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseXml } from "@poe-code/xml-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [metadata, language] of [
    [[], ""],
    [["-metadata:s:s:0", "language=pl"], "pl"],
    [["-metadata:s:s:0", "language=und"], "und"],
    [["-metadata", "language=pl"], ""],
    [["-metadata", "language=fr", "-metadata:s:s:0", "language=pl"], "pl"],
    [["-metadata:s:s:0", 'language=a&"<b>'], 'a&"<b>'],
    [["-metadata:s:s:0", "language="], ""]
  ] as const) {
    it(`${sync ? "sync" : "async"} sets TTML xml:lang for ${JSON.stringify(metadata)}`, async () => {
      const volume = Volume.fromJSON({
        "/in.vtt": `WEBVTT\n\ncue-1\n00:01.000 --> 00:02.500 align:start position:20%\nhello\n\n`
      });
      const args = ["-v", "error", "-i", "/in.vtt", ...metadata, "-f", "ttml", sync ? "/out.ttml" : "pipe:1"];
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
      const attribute = root.attributes.find(attribute => attribute.localName === "lang");
      assert.ok(attribute);
      assert.equal(attribute.namespace, "http://www.w3.org/XML/1998/namespace");
      assert.equal(attribute.value, language);
    });
  }
}
