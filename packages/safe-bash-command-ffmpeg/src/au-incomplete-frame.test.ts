import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg decodes four complete samples and stream-copies all nine bytes.
for (const copy of [false, true]) {
  it(`handles an AU trailing partial PCM frame during ${copy ? "copy" : "decode"}`, async () => {
    const input = Buffer.from("2e736e6400000020000000090000000300001f400000000100000000000000000064ff38012cfe7058", "hex");
    const volume = Volume.fromJSON({ "/input.au": input });
    const args = ["-y", "-v", "error", "-i", "/input.au", "-c:a",
      ...(copy ? ["copy", "/output.au"] : ["pcm_s16le", "-f", "s16le", "/output.raw"])];
    const verify = () => {
      const output = volume.readFileSync(copy ? "/output.au" : "/output.raw") as Buffer;
      if (copy) {
        assert.equal(output.readUInt32BE(8), 9);
        assert.equal(output.subarray(output.readUInt32BE(4)).toString("hex"), "0064ff38012cfe7058");
      } else {
        assert.equal(output.toString("hex"), "640038ff2c0170fe");
      }
    };
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
    verify();
    volume.unlinkSync(copy ? "/output.au" : "/output.raw");
    const sync = evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
    assert.equal(sync, "");
    verify();
  });
}
