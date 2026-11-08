import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const cases = [
  { name: "initial five-second playlist", seconds: 5, args: [], durations: [1, 1, 1, 1, 1] },
  { name: "normal interval after initial window", seconds: 12, args: [], durations: [1, 1, 1, 1, 1, 1, 1, 2, 2, 1] },
  { name: "two-entry window", seconds: 12, args: ["-hls_list_size", "2"], durations: [1, 1, 1, 1, 2, 2, 2, 2] },
  { name: "unlimited playlist", seconds: 5, args: ["-hls_list_size", "0"], durations: [2, 2, 1] },
  { name: "event playlist", seconds: 12, args: ["-hls_playlist_type", "event"], durations: Array(12).fill(1) as number[] },
  { name: "append mode", seconds: 5, args: ["-hls_flags", "append_list"], durations: [2, 2, 1] },
  { name: "disabled initial interval", seconds: 5, args: ["-hls_init_time", "0"], durations: [2, 2, 1] },
  { name: "duration units", seconds: 5, args: ["-hls_init_time", "1000ms"], durations: [1, 1, 1, 1, 1] }
];
for (const entry of cases) {
  it(`honors hls_init_time for ${entry.name}`, async () => {
    const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 4, frameCount: entry.seconds * 4, includeAudio: false }));
    const input = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({ ...track,
      samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 4 === 0 }))
    })) });
    const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/in.mp4", "-c", "copy", "-hls_time", "2", "-hls_init_time", "1", "-hls_segment_type", "fmp4", ...entry.args, "/out.m3u8"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); },
        async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const lines = String(volume.readFileSync("/out.m3u8")).trim().split("\n");
    const size = entry.args.includes("event") || entry.args.includes("0") && entry.args.includes("-hls_list_size") ? 0 : entry.args.includes("-hls_list_size") ? 2 : 5;
    assert.deepEqual(lines.filter(line => line.startsWith("#EXTINF:")).map(line => Number(line.slice(8).split(",")[0])), size ? entry.durations.slice(-size) : entry.durations);
    const init = volume.readFileSync("/init.mp4") as Buffer;
    assert.equal(volume.readdirSync("/").filter(name => String(name).endsWith(".m4s")).length, entry.durations.length);
    for (const [index, duration] of entry.durations.entries()) {
      const segment = volume.readFileSync(`/out${index}.m4s`) as Buffer;
      const track = parseMp4(Buffer.concat([init, segment])).tracks[0]!;
      assert.equal(track.samples.length, duration * 4);
      assert.equal(track.samples.reduce((sum, sample) => sum + sample.duration, 0) / track.timescale, duration);
    }
  });
}

for (const value of ["bad", "-1", "9223372036855", undefined]) {
  it(`rejects invalid hls_init_time ${value}`, async () => {
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hls_init_time", ...(value === undefined ? [] : [value])],
      cwd: "/", env: {}, signal: new AbortController().signal,
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 1);
    assert.ok(stderr.includes("invalid hls_init_time"), stderr);
  });
}
