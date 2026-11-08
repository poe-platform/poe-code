import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native tools exchange media through pipes; no test files are written.
const nativeAvailable = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

it("preserves MP4 audio defaults and the cleared-disposition fallback, verified by native ffprobe", { skip: !nativeAvailable }, async () => {
  const generated = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000:duration=0.1", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=16000:duration=0.1", "-map", "0:a", "-map", "1:a", "-c:a", "aac", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"]);
  assert.equal(generated.status, 0, generated.stderr.toString());
  const input = parseMp4(generated.stdout);
  assert.notDeepEqual(input.tracks[0]!.samples[0]!.data, input.tracks[1]!.samples[0]!.data);
  const bytes = serializeMp4({ ...input, tracks: input.tracks.map((track, index) => ({ ...track, enabled: index === 0, language: index === 0 ? "eng" : "fra" })) });
  for (const [options, expected] of [
    [["-disposition:a:0", "0", "-disposition:a:1", "default"], [0, 1]],
    [["-disposition:a:0", "-default", "-disposition:a:1", "+default"], [0, 1]],
    [["-disposition", "0", "-disposition:1", "1"], [0, 1]],
    [["-disposition:a:0", "0", "-disposition:m:language:fra", "default"], [0, 1]],
    [["-disposition:a:0", "0", "-disposition:a:m:language:fra", "default"], [0, 1]],
    [["-disposition:a", "0"], [1, 0]],
    [["-disposition:a", "-default"], [1, 0]],
  ] as const) {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.mp4", bytes);
    const args = ["-y", "-i", "/in.mp4", "-map", "0:a", "-c", "copy", ...options, "/out.mp4"];
    assert.equal(evalSyncFfmpeg(args, undefined,
      path => volume.existsSync(path) ? new Uint8Array(volume.readFileSync(path) as Uint8Array) : undefined,
      (path, data) => { volume.writeFileSync(path, data); return true; }), undefined);
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(data: Uint8Array) { errors.push(data); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const output = volume.readFileSync("/out.mp4") as Buffer;
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=index:stream_disposition=default", "-of", "json", "pipe:0"], { input: output });
    assert.equal(probe.status, 0, probe.stderr.toString());
    const streams = JSON.parse(probe.stdout.toString()).streams as { disposition: { default: number } }[];
    assert.deepEqual(streams.map(stream => stream.disposition.default), expected);
    const actual = parseMp4(output);
    assert.deepEqual(actual.tracks.map(track => track.language), ["eng", "fra"]);
    assert.deepEqual(actual.tracks.map(track => track.samples.map(sample => sample.data)), input.tracks.map(track => track.samples.map(sample => sample.data)));
  }
});
