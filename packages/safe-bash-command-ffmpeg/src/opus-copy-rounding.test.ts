import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { oggAst, parseMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/tone-opus.ogg", import.meta.url));

for (const sync of [false, true]) for (const limit of [false, true]) {
  it(`${sync ? "sync" : "async"} Opus copy rounds the first timestamp without shifting later packets${limit ? " with a frame limit" : ""}`, async () => {
    const volume = Volume.fromJSON({ "/in.ogg": input });
    const args = ["-i", "/in.ogg", "-c", "copy", ...(limit ? ["-frames:a", "5"] : []), "/out.mkv"];
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
    const track = parseMkv(new Uint8Array(volume.readFileSync("/out.mkv") as Buffer)).tracks[0]!;
    const source = oggAst().parse(new Uint8Array(input), { decodeAudio: false }).tracks[0]!;
    const expected = limit ? source.samples.slice(0, 5) : source.samples;
    assert.deepEqual(track.samples.map(sample => sample.pts), expected.map((_, index) => index ? index * 20 - 6 : -7));
    assert.deepEqual(track.samples.map(sample => sample.data), expected.map(sample => sample.data));
    assert.equal(track.codecDelayNs, 6_500_000);
  });
}
