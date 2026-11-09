import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv, serializeMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Two distinct AAC speakers (Alice/Bob), six packets each, and one SubRip track.
// All input default flags are zero. Native checks exchange media through pipes.
const input = readFileSync(new URL("./fixtures/unmarked-audio.mkv", import.meta.url));
const source = parseMkv(input);
const nativeAvailable = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

for (const { name, maps, options, order, defaults, marked = false } of [
  { name: "first mapped audio", maps: ["0"], options: [], order: [0, 1, 2], defaults: [1, 0, 0] },
  { name: "reversed audio", maps: ["0:a:1", "0:a:0", "0:s"], options: [], order: [1, 0, 2], defaults: [1, 0, 0] },
  { name: "single unmarked audio", maps: ["0:a:1"], options: [], order: [1], defaults: [0] },
  { name: "explicit clearing", maps: ["0"], options: ["-disposition:a", "0", "-disposition:s", "0"], order: [0, 1, 2], defaults: [0, 0, 0] },
  { name: "explicit subtitle disposition", maps: ["0"], options: ["-disposition:s", "0"], order: [0, 1, 2], defaults: [0, 0, 0] },
  { name: "unmatched disposition", maps: ["0"], options: ["-disposition:v", "0"], order: [0, 1, 2], defaults: [1, 0, 0] },
  { name: "explicit second audio default", maps: ["0"], options: ["-disposition:a:1", "default"], order: [0, 1, 2], defaults: [0, 1, 0] },
  { name: "existing second audio default", maps: ["0"], options: [], order: [0, 1, 2], defaults: [0, 1, 0], marked: true },
  { name: "relative default removal", maps: ["0"], options: ["-disposition:a:1", "-default"], order: [0, 1, 2], defaults: [0, 0, 0], marked: true },
  { name: "relative comment preserves unmarked audio", maps: ["0"], options: ["-disposition:a:1", "+comment"], order: [0, 1, 2], defaults: [0, 0, 0] },
]) {
  it(`copies Matroska ${name} without changing titles or packets`, async () => {
    assert.deepEqual(source.tracks.map(track => track.disposition?.default), [0, 0, 0]);
    const bytes = marked ? serializeMkv({ ...source, tracks: source.tracks.map((track, index) => ({
      ...track, disposition: { ...track.disposition, default: index === 1 ? 1 : 0 }
    })) }) : input;
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.mkv", bytes);
    const outputOptions = [...maps.flatMap(map => ["-map", map]), "-c", "copy", ...options];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.mkv", ...outputOptions, "/out.mkv"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(data: Uint8Array) { errors.push(data); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const output = volume.readFileSync("/out.mkv") as Buffer;
    const actual = parseMkv(output).tracks;
    assert.deepEqual(actual.map(track => track.disposition?.default), defaults);
    assert.deepEqual(actual.map(track => [track.type, track.metadata?.title]),
      order.map(index => [source.tracks[index]!.type, source.tracks[index]!.metadata?.title]));
    assert.deepEqual(actual.map(track => track.samples.map(sample => Buffer.from(sample.data))),
      order.map(index => source.tracks[index]!.samples.map(sample => Buffer.from(sample.data))));
    if (nativeAvailable) {
      const native = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", ...outputOptions, "-f", "matroska", "pipe:1"], { input: bytes });
      assert.equal(native.status, 0, native.stderr.toString());
      for (const media of [native.stdout, output]) {
        const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream_disposition=default", "-of", "json", "pipe:0"], { input: media });
        assert.equal(probe.status, 0, probe.stderr.toString());
        const streams = JSON.parse(probe.stdout.toString()).streams as { disposition: { default: number } }[];
        assert.deepEqual(streams.map(stream => stream.disposition.default), defaults);
      }
    }
  });
}

for (const options of [[], ["-disposition:a", "0", "-disposition:s", "0"]]) {
  it(`keeps automatically selected single audio unmarked in synchronous copy: ${options.join(" ")}`, () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.mkv", input);
    assert.equal(evalSyncFfmpeg(["-i", "/in.mkv", "-c", "copy", ...options, "/out.mkv"], undefined,
      path => volume.existsSync(path) ? new Uint8Array(volume.readFileSync(path) as Uint8Array) : undefined,
      (path, data) => { volume.writeFileSync(path, data); return true; }), "");
    assert.deepEqual(parseMkv(volume.readFileSync("/out.mkv") as Buffer).tracks.map(track => track.disposition?.default), [0, 0]);
  });
}
