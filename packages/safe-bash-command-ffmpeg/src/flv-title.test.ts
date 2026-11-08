import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseFlv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const fixture = readFileSync(new URL("../../mp4-ast/src/fixtures/title.flv", import.meta.url));

for (const sync of [false, true]) {
  it(`${sync ? "sync" : "async"} FLV stream copy preserves title and encoded packets`, async () => {
    const volume = Volume.fromJSON({ "/in.flv": fixture });
    const args = ["-y", "-v", "error", "-i", "/in.flv", ...(sync ? [] : ["-map", "0"]), "-c", "copy", "/out.flv"];
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
    const copied = parseFlv(new Uint8Array(volume.readFileSync("/out.flv") as Buffer));
    const source = parseFlv(new Uint8Array(fixture));
    assert.equal(source.metadata.title, "Lecture");
    assert.equal(copied.metadata.title, "Lecture");
    assert.equal(copied.tracks.length, 2);
    for (const track of source.tracks) {
      const output = copied.tracks.find(candidate => candidate.type === track.type)!;
      assert.deepEqual(output.samples.map(sample => sample.data), track.samples.map(sample => sample.data));
      assert.deepEqual(output.samples.map(sample => sample.dts), track.samples.map(sample => sample.dts));
    }
  });
}
