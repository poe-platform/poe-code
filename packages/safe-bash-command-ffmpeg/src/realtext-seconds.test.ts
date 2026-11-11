import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const suffix of ["", "s"]) {
  for (const sync of [false, true]) {
    it(`converts RealText seconds${suffix ? " with suffix" : ""} to SRT (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({
        "/in.rt": `<window><time begin="1${suffix}" end="2${suffix}"><clear/>Alpha</window>`
      });
      const args = ["-v", "error", "-f", "realtext", "-i", "/in.rt", "-f", "srt", "pipe:1"];
      let stdout = "";
      if (sync) {
        assert.equal(evalSyncFfmpeg([...args.slice(0, -1), "/out.srt"], undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, data) => { volume.writeFileSync(path, data); return true; }), "");
        stdout = String(volume.readFileSync("/out.srt"));
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(data: Uint8Array) { stdout += new TextDecoder().decode(data); } },
          stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
      }
      assert.equal(stdout, "1\n00:00:01,000 --> 00:00:02,000\nAlpha\n\n");
    });
  }
}
