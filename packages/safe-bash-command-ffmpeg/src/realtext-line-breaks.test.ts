import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const count of [1, 2, 3]) {
  it(`preserves ${count} RealText breaks in WebVTT through both command paths`, async () => {
    const volume = Volume.fromJSON({
      "/in.rt": `<window><time begin="1" end="2"><clear/>A${"<br/>".repeat(count)}B</window>`
    });
    const args = ["-v", "error", "-f", "realtext", "-i", "/in.rt", "-f", "webvtt", "pipe:1"];
    const expected = `WEBVTT\n\n00:01.000 --> 00:02.000\nA${"\n".repeat(count)}B\n`;
    let stdout = "";
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
    assert.equal(stdout, expected);
    assert.equal(evalSyncFfmpeg([...args.slice(0, -1), "/out.vtt"], undefined,
      path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
    assert.equal(volume.readFileSync("/out.vtt", "utf8"), expected);
  });
}
