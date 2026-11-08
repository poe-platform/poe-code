import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const unknown of [false, true]) {
  it(`${unknown ? "rejects an unknown" : "decodes the standard"} extensible PCM GUID`, async () => {
    const input = Buffer.from("524946464400000057415645666d742028000000feff0100401f0000803e00000200100016001000040000000100000000001000800000aa00389b71646174610800000064009cffc80038ff", "hex");
    if (unknown) input[59] = input[59]! ^ 1;
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav", "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (unknown) {
      assert.notEqual(result.exitCode, 0);
      assert.match(stderr, /Unsupported WAV subformat GUID/);
      assert.equal(volume.existsSync("/out.raw"), false);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readFileSync("/out.raw"), input.subarray(68));
    }
  });
}
