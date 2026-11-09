import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";


const cues = [
  ['<foo>one</foo>two', 'onetwo'],
  ['<font color="red">red</font>', '<font color="#ff0000">red</font>'],
  ['<font color="#AABBCC">hex</font>', '<font color="#aabbcc">hex</font>'],
  ['<font color=blue>blue</font>', '<font color="#0000ff">blue</font>'],
  ['<font face="Arial" size="24" color="red">styled</font>',
    '<font face="Arial"><font size="24"><font color="#ff0000">styled</font></font></font>'],
  ['<b>bold</b><i>italic</i><u>underline</u><s>strike</s>',
    '<b>bold</b><i>italic</i><u>underline</u><s>strike</s>'],
  ['<font color="invalid">plain</font>', 'plain'],
  ['before<foo><i>inside</i></foo>after', 'before<i>inside</i>after']
];
const input = cues.map(([text], index) => `${index + 1}\n00:00:00,000 --> 00:00:01,000\n${text}\n\n`).join("");
const encoded = cues.map(([, text], index) => `${index + 1}\n00:00:00,000 --> 00:00:01,000\n${text}\n\n`).join("");

for (const sync of [false, true]) {
  for (const codec of [undefined, "srt", "subrip", "copy"]) {
    it(`${sync ? "sync" : "async"} normalizes SubRip markup with ${codec ?? "default"} encoding`, async () => {
      const volume = Volume.fromJSON({ "/in.srt": input });
      const args = ["-y", "-v", "error", "-i", "/in.srt", ...(codec ? ["-c:s", codec] : []), "/out.srt"];
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
      assert.equal(volume.readFileSync("/out.srt", "utf8"), codec === "copy" ? input : encoded);
    });
  }
}
