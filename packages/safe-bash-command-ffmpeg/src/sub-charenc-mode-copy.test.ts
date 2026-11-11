import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const mode of ["bad", "auto"]) {
  for (const copy of [false, true]) {
    it(`sub_charenc_mode ${mode} ${copy ? "copies" : "transcodes"} UTF-8 subtitle packets`, async () => {
      const input = Buffer.from("1\n00:00:01,000 --> 00:00:03,000\nCafé €\n");
      const expected = mode === "bad" && !copy ? Buffer.alloc(0) : Buffer.concat([input, Buffer.from("\n")]);
      const volume = Volume.fromJSON({ "/in.srt": input, "/out.srt": "KEEP" });
      const options = ["-v", "error", "-y", "-sub_charenc_mode", mode, "-i", "/in.srt", ...(copy ? ["-c:s", "copy"] : [])];
      // Invalid modes need the async path to emit the decoder diagnostic, even for copy.
      const syncResult = evalSyncFfmpeg([...options, "/out.srt"], undefined,
        path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
      assert.equal(syncResult, mode === "bad" ? undefined : "");
      assert.deepEqual(volume.readFileSync("/out.srt"), mode === "bad" ? Buffer.from("KEEP") : expected);
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: [...options, "-f", "srt", "pipe:1"], cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, mode === "bad" && !copy ? 234 : 0, stderr);
      assert.deepEqual(Buffer.concat(stdout), expected);
      if (mode === "bad") assert.match(stderr, /Invalid sub_charenc_mode.*bad/);
      else assert.equal(stderr, "");
      assert.deepEqual(volume.readFileSync("/in.srt"), input);
    });
  }
}
