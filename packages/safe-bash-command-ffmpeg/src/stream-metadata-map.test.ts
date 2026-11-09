import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { mkvAst } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/metadata-map/input.mkv", import.meta.url));
const original = mkvAst().parse(input);
const cases = [
  ...["9:s:a:0", "0:s:a:9", "0:s:a:nope", "nope", ""].map(source => ({
    name: `invalid source ${source}`, options: ["-map_metadata:s:a", source], tags: []
  })),
  { name: "invalid destination", options: ["-map_metadata:s:a:nope", "0:s:a:0"], tags: [] },
  { name: "control", options: [], tags: [["Alice", "eng"], ["Bob", "fra"]] },
  { name: "one destination", options: ["-map_metadata:s:a:0", "0:s:a:1"], tags: [["Bob", "fra"], [undefined, "und"]] },
  { name: "swap", options: ["-map_metadata:s:a:0", "0:s:a:1", "-map_metadata:s:a:1", "0:s:a:0"], tags: [["Bob", "fra"], ["Alice", "eng"]] },
  { name: "all audio", options: ["-map_metadata:s:a", "0:s:a:1"], tags: [["Bob", "fra"], ["Bob", "fra"]] },
  { name: "clear", options: ["-map_metadata:s:a", "-1"], tags: [[undefined, "und"], [undefined, "und"]] },
  { name: "explicit override", options: ["-map_metadata:s:a", "0:s:a:1", "-metadata:s:a:0", "title=Edited"], tags: [["Edited", "fra"], ["Bob", "fra"]] },
  { name: "first source wins", options: ["-map_metadata:s:a", "0:s:a:1", "-map_metadata:s:a", "0:s:a:0"], tags: [["Bob", "fra"], ["Bob", "fra"]] }
];
for (const sync of [false, true]) {
  for (const { name, options, tags } of cases) {
    it(`maps stream metadata: ${name} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.mkv", input);
      volume.writeFileSync("/out.mkv", input);
      const invalid = name.startsWith("invalid");
      const args = ["-y", "-i", "/in.mkv", ...(sync ? [] : ["-map", "0:a"]), "-c", "copy", ...options, "/out.mkv"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), invalid ? undefined : "");
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
        if (invalid) assert.notEqual(result.exitCode, 0, stderr);
        else assert.equal(result.exitCode, 0, stderr);
      }
      if (invalid) {
        assert.deepEqual(volume.readFileSync("/out.mkv"), input);
        return;
      }
      const output = mkvAst().parse(volume.readFileSync("/out.mkv") as Buffer);
      assert.equal(output.metadata.title, original.metadata.title);
      assert.deepEqual(output.tracks.map(track => [track.metadata?.title, track.language]), sync ? tags.slice(0, 1) : tags);
      for (const [index, track] of output.tracks.entries()) {
        assert.deepEqual(track.samples.map(sample => sample.data), original.tracks[index]!.samples.map(sample => sample.data));
      }
      assert.deepEqual(volume.readFileSync("/in.mkv"), input);
    });
  }
}
