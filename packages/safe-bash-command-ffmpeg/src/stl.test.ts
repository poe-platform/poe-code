import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const stl = "00:00:00:15,00:00:01:15,First|line\r\n00:00:02:00,00:00:03:15,Second\r\n";
const expected = "1\n00:00:00,150 --> 00:00:01,150\nFirst\nline\n\n2\n00:00:02,000 --> 00:00:03,150\nSecond\n\n";
for (const sync of [false, true]) {
  for (const format of ["stl", "srt", undefined]) {
    it(`${sync ? "sync" : "async"} ${format ?? "unforced STL"} preserves caption clocks or rejects without overwriting`, async () => {
      const volume = Volume.fromJSON({ "/clock.stl": format === "srt" ? expected : stl, "/out.srt": "keep" });
      const args = ["-v", "error", "-y", ...(format ? ["-f", format] : []), "-i", "/clock.stl", "-c:s", "srt", "/out.srt"];
      let error: string | undefined = "";
      if (sync) {
        error = evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, data) => { volume.writeFileSync(path, data); return true; });
      } else {
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(data: Uint8Array) { error += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode, format ? 0 : 1, error);
      }
      if (format) assert.equal(error, "");
      else assert.notEqual(error, "");
      assert.equal(String(volume.readFileSync("/out.srt")).replaceAll("\r\n", "\n"), format ? expected : "keep");
    });
  }
}
