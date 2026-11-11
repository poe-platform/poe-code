import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const caption of ["A &amp; B &lt; C", "A &quot; B &#65;", "one&nbsp;two", "plain"]) {
  for (const sync of [false, true]) {
    it(`preserves literal SAMI entities in ${sync ? "sync" : "async"} SRT output: ${caption}`, async () => {
      const volume = Volume.fromJSON({ "/in.smi": `<SAMI>\n<BODY>\n<SYNC Start=1000><P>${caption}\n<SYNC Start=3000><P>done\n</BODY>\n</SAMI>\n` });
      const args = ["-v", "error", "-f", "sami", "-i", "/in.smi", "-f", "srt", "pipe:1"];
      let stdout = "";
      let stderr = "";
      if (sync) {
        assert.equal(evalSyncFfmpeg([...args.slice(0, -1), "/out.srt"], undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        stdout = volume.readFileSync("/out.srt", "utf8") as string;
      } else {
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
        assert.equal(result.exitCode, 0);
      }
      assert.equal(stderr, "");
      assert.equal(stdout, `1\n00:00:01,000 --> 00:00:03,000\n${caption}\n\n2\n00:00:03,000 --> 1193:02:50,295\ndone\n\n`);
    });
  }
}
