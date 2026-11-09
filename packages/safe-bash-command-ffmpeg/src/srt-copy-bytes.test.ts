import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [name, payload] of [
    ["non-UTF-8", Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0x80])],
    ["UTF-8", Buffer.from("Café €")]
  ] as const) {
    it(`${sync ? "sync" : "async"} stream copy preserves ${name} SubRip bytes when overwriting`, async () => {
      const input = Buffer.concat([
        Buffer.from("1\n00:00:01,000 --> 00:00:02,000\n"), payload, Buffer.from("\n\n")
      ]);
      const volume = Volume.fromJSON({ "/copy.srt": input, "/copy-out.srt": "KEEP" });
      const args = ["-v", "error", "-y", "-i", "/copy.srt", "-c:s", "copy", "/copy-out.srt"];
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
        assert.equal(stderr, "");
      }
      assert.deepEqual(volume.readFileSync("/copy-out.srt"), input);
    });
  }
}
