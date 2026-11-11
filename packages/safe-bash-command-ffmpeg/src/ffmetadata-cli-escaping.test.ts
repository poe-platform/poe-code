import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  it(`escapes multiline CLI metadata from WAV input (${sync ? "sync" : "async"})`, async () => {
    const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(8000)] });
    const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
    const args = ["-y", "-v", "error", "-i", "/in.wav", "-metadata", "comment=Line1\nLine2;#=ok", "-metadata", "title=path\\file\nnext;#=ok", "-bitexact", "-f", "ffmetadata", "/out.ffmeta"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
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
    assert.equal(volume.readFileSync("/out.ffmeta", "utf8"),
      ";FFMETADATA1\ntitle=path\\\\file\\\nnext\\;\\#\\=ok\ncomment=Line1\\\nLine2\\;\\#\\=ok\n");
  });
}
