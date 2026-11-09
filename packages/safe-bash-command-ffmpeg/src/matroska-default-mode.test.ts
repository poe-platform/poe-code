import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv, serializeMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const source = parseMkv(readFileSync(new URL("../../mp4-ast/src/fixtures/track-dispositions.mkv", import.meta.url)));
const tracks = source.tracks.filter(track => track.type === "audio" || track.type === "subtitle").map((track, index) => ({
  ...track, disposition: { default: 0 }, metadata: { title: ["Alice", "Bob", "Captions"][index]! }
}));
const input = serializeMkv({ ...source, tracks });
const nativeAvailable = spawnSync("ffprobe", ["-version"]).status === 0;

for (const sync of [false, true]) {
  for (const [mode, explicit, expected] of [
    [undefined, false, [0, 0, 0]],
    ["passthrough", false, [0, 0, 0]],
    ["infer", false, [1, 0, 1]],
    ["infer_no_subs", false, [1, 0, 0]],
    ["infer_no_subs", true, [0, 1, 0]],
    ["invalid", false, []]
  ] as const) {
    it(`Matroska default_mode=${mode}, explicit=${explicit}, sync=${sync}`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.mkv", input);
      const args = ["-y", "-i", "/in.mkv", ...(sync ? [] : ["-map", "0"]), "-c", "copy",
        "-disposition:a", "0", "-disposition:s", "0", ...(explicit ? ["-disposition:a:1", "default"] : []),
        ...(mode === undefined ? [] : ["-default_mode", mode]), "/out.mkv"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), mode === "invalid" ? undefined : "");
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
        assert.equal(result.exitCode === 0, mode !== "invalid", stderr);
      }
      if (mode === "invalid") { assert.equal(volume.existsSync("/out.mkv"), false); return; }
      const bytes = volume.readFileSync("/out.mkv") as Buffer;
      const actual = parseMkv(bytes).tracks;
      const selected = sync ? [tracks[0]!, ...tracks.filter(track => track.type === "subtitle")] : tracks;
      const defaults = sync ? [explicit ? 1 : expected[0], expected[2]] : expected;
      assert.deepEqual(actual.map(track => track.disposition?.default), defaults);
      assert.deepEqual(actual.map(track => track.metadata?.title), selected.map(track => track.metadata.title));
      assert.deepEqual(actual.map(track => track.samples.map(sample => Buffer.from(sample.data))),
        selected.map(track => track.samples.map(sample => Buffer.from(sample.data))));
      if (nativeAvailable) {
        const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream_disposition=default", "-of", "json", "pipe:0"], { input: bytes });
        assert.equal(probe.status, 0, probe.stderr.toString());
        assert.deepEqual(JSON.parse(probe.stdout.toString()).streams.map((stream: { disposition: { default: number } }) => stream.disposition.default), defaults);
      }
    });
  }
}
