import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const aqtitle = "-->> 12\nFirst\nline\n\n-->> 50\nSecond\n\n-->> 75\n";
const expected = "1\n00:00:00,480 --> 00:00:02,000\nFirst\nline\n\n2\n00:00:02,000 --> 00:00:03,000\nSecond\n\n";
for (const sync of [false, true]) {
  for (const rate of [25, 50]) {
    for (const forced of [false, true]) {
      for (const format of ["aqtitle", "srt"]) {
        it(`${sync ? "sync" : "async"} ${rate} fps ${forced ? "forced" : "detected"} ${format} preserves timing and lines`, async () => {
          const volume = Volume.fromJSON({ "/end.txt": format === "aqtitle" ? aqtitle : expected, "/out.srt": "keep" });
          const args = ["-v", "error", "-y", ...(forced ? ["-f", format] : []), ...(rate === 50 ? ["-subfps", "50"] : []), "-i", "/end.txt", "-c:s", "srt", "/out.srt"];
          if (sync) {
            assert.equal(evalSyncFfmpeg(args, undefined,
              path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
              (path, data) => { volume.writeFileSync(path, data); return true; }), "");
          } else {
            let stderr = "";
            const result = await createFfmpegCommand().execute({
              args, cwd: "/", env: {}, signal: new AbortController().signal,
              fs: {
                async readFile(path: string) { return volume.readFileSync(path); },
                async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
                async stat(path: string) { return volume.statSync(path); }
              },
              stdin: (async function* () {})(), stdout: { async write() {} },
              stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
            } as never);
            assert.equal(result.exitCode, 0, stderr);
          }
          assert.equal(String(volume.readFileSync("/out.srt")).replaceAll("\r\n", "\n"), format === "aqtitle" && rate === 50 ? expected.replace("00,480", "00,240").replaceAll("02,000", "01,000").replace("03,000", "01,500") : expected);
        });
      }
    }
  }
}
