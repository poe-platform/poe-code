import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  it(`rounds SRT starts and durations for ASS output (sync=${sync})`, async () => {
    const volume = Volume.fromJSON({ "/in.srt": "1\n00:00:01,006 --> 00:00:02,019\nFirst\n\n2\n00:00:03,004 --> 00:00:04,005\nSecond\n\n3\n00:00:05,005 --> 00:00:06,010\nTie\n" });
    const args = ["-y", "-v", "error", "-i", "/in.srt", "/out.ass"];
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
    }
    assert.deepEqual(String(volume.readFileSync("/out.ass", "utf8")).split("\n").filter(line => line.startsWith("Dialogue:")), [
      "Dialogue: 0,0:00:01.01,0:00:02.02,Default,,0,0,0,,First",
      "Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,Second",
      "Dialogue: 0,0:00:05.01,0:00:06.02,Default,,0,0,0,,Tie"
    ]);
  });
}
