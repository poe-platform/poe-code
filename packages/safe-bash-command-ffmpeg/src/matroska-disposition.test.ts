import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv, serializeMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const source = parseMkv(readFileSync(new URL("../../mp4-ast/src/fixtures/track-dispositions.mkv", import.meta.url)));
const tracks = source.tracks.filter(track => track.type === "audio").map((track, index) => ({
  ...track, disposition: index === 0 ? { default: 1 } : { default: 0, hearing_impaired: 1 }
}));
const nativeAvailable = spawnSync("ffprobe", ["-version"]).status === 0;

for (const sync of [false, true]) {
  for (const [value, expected] of [
    [undefined, [0, 1, 0]],
    ["0", [0, 0, 0]],
    ["default", [1, 0, 0]],
    ["1", [1, 0, 0]],
    ["comment", [0, 0, 1]],
    ["+default", [1, 1, 0]],
    ["-default", [0, 1, 0]],
    ["+comment", [0, 1, 1]],
    ["default+comment", [1, 0, 1]],
  ] as const) {
    it(`${sync ? "sync" : "async"} Matroska copy writes disposition ${value ?? "unchanged"} without changing packets`, async () => {
      // Explicit maps use the async command. The sync path covers a single audio track.
      const inputTracks = sync ? [tracks[1]!] : tracks;
      const input = serializeMkv({ ...source, tracks: inputTracks });
      const volume = Volume.fromJSON({ "/in.mkv": Buffer.from(input) });
      const args = ["-y", "-i", "/in.mkv", ...(sync ? [] : ["-map", "0:a"]), "-c", "copy",
        ...(value === undefined ? [] : [`-disposition:a:${sync ? 0 : 1}`, value]), "/out.mkv"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      } else {
        const errors: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      }
      const output = volume.readFileSync("/out.mkv") as Buffer;
      const actual = parseMkv(output);
      const expectedFlags = sync ? [expected] : [[1, 0, 0], expected];
      assert.deepEqual(actual.tracks.map(track => [track.disposition?.default ?? 0,
        track.disposition?.hearing_impaired ?? 0, track.disposition?.comment ?? 0]), expectedFlags);
      assert.deepEqual(actual.tracks.map(track => track.samples.map(sample => sample.data)),
        inputTracks.map(track => track.samples.map(sample => sample.data)));
      if (nativeAvailable) {
        const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries",
          "stream_disposition=default,hearing_impaired,comment", "-of", "json", "pipe:0"], { input: output });
        assert.equal(probe.status, 0, probe.stderr.toString());
        const streams = JSON.parse(probe.stdout.toString()).streams as { disposition: Record<string, number> }[];
        assert.deepEqual(streams.map(stream => [stream.disposition.default,
          stream.disposition.hearing_impaired, stream.disposition.comment]), expectedFlags);
      }
    });
  }
}
