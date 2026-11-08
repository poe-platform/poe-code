import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, parseMpegTs, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

it("HLS reports AAC packet boundaries and the partial final packet duration", async () => {
  const doc = parseMp4(readFileSync(new URL("./fixtures/aac-cutoff.m4a", import.meta.url)));
  const track = doc.tracks[0]!;
  const samples = Array.from({ length: 161 }, (_, index) => ({
    ...track.samples[0]!, dts: index * 1024, pts: index * 1024,
    duration: index === 160 ? 384 : 1024
  }));
  const input = serializeMp4({ ...doc, tracks: [{ ...track, timescale: 48000,
    duration: 164224, samples, editList: [{ segmentDuration: Math.round(3.4 * doc.timescale),
      mediaTime: 1024, mediaRateInteger: 1, mediaRateFraction: 0 }] }] });
  const volume = Volume.fromJSON({ "/source.m4a": Buffer.from(input) });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-i", "/source.m4a", "-map", "0:a", "-c", "copy", "-f", "hls",
      "-hls_time", "1", "-hls_list_size", "0", "/media.m3u8"],
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
  const lines = String(volume.readFileSync("/media.m3u8")).trim().split("\n");
  assert.deepEqual(lines.filter(line => line.startsWith("#EXTINF:")),
    ["1.002667", "1.002667", "1.002667", "0.413333"].map(value => `#EXTINF:${value},`));
  const paths = lines.filter(line => !line.startsWith("#"));
  assert.deepEqual(paths, ["media0.ts", "media1.ts", "media2.ts", "media3.ts"]);
  const segments = paths.map(path => parseMpegTs(volume.readFileSync(`/${path}`) as Buffer).tracks[0]!);
  assert.deepEqual(segments.map(segment => segment.samples.length), [47, 47, 47, 20]);
  assert.equal(segments.reduce((count, segment) => count + segment.samples.length, 0), samples.length);
});
