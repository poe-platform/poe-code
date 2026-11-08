import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const copy of [false, true]) {
  it(`${copy ? "rejects WAV copy of" : "decodes"} pcm_f24le`, async () => {
    const input = Buffer.from("524946464c00000057415645666d742028000000feff0100401f0000007d00000400200016001800040000000100000000001000800000aa00389b7164617461100000000000804a000080ca0000004a000000ca", "hex");
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: copy ? ["-y", "-v", "error", "-i", "/in.wav", "-c:a", "copy", "/out.wav"] : ["-y", "-v", "error", "-i", "/in.wav", "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (copy) {
      assert.notEqual(result.exitCode, 0);
      assert.match(stderr, /pcm_f24le/);
      assert.equal(volume.existsSync("/out.wav"), false);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from("004000c0002000e0", "hex"));
    }
  });
}
