import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const fixture = readFileSync(new URL("../../mp4-ast/src/fixtures/opus-delay.webm", import.meta.url));

for (const sync of [false, true]) {
  it(`${sync ? "sync" : "async"} WebM copy preserves Opus decoder timing and A/V alignment`, async () => {
    const volume = Volume.fromJSON({ "/in.webm": fixture });
    const args = ["-y", "-v", "error", "-i", "/in.webm", ...(sync ? [] : ["-map", "0"]), "-c", "copy", "/out.webm"];
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
    const copied = parseMkv(new Uint8Array(volume.readFileSync("/out.webm") as Buffer));
    const audio = copied.tracks.find(track => track.type === "audio")!;
    assert.equal(audio.codecDelayNs, 6_500_000);
    assert.equal(audio.seekPreRollNs, 80_000_000);
    assert.equal(audio.samples[0]!.pts, -7);
    assert.equal(copied.tracks[0]!.samples[0]!.pts, 0);
    const source = parseMkv(new Uint8Array(fixture));
    assert.deepEqual(copied.tracks.map(track => track.samples.map(sample => [sample.pts, sample.data])),
      source.tracks.map(track => track.samples.map(sample => [sample.pts, sample.data])));
  });
}
