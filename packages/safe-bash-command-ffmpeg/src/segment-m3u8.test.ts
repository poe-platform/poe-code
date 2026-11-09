import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(volume: Volume, list: string, options: string[] = []) {
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/ramp.wav", "-c", "copy", "-f", "segment",
      "-segment_time", "1", "-segment_list", list, ...options, "/part%02d.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr };
}

function source() {
  return Volume.fromJSON({ "/ramp.wav": Buffer.from(encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from({ length: 24000 }, (_, index) => index / 32768)] })) });
}

for (const filename of ["list.m3u8", "list.M3U8", "list.csv"]) {
  it(`matches native segment list ${filename} and preserves all WAV samples`, async () => {
    const volume = source();
    const result = await run(volume, filename);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(volume.readFileSync(`/${filename}`, "utf8"), filename === "list.csv"
      ? "part00.wav,0.000000,1.024000\npart01.wav,1.024000,2.048000\npart02.wav,2.048000,3.000000\n"
      : "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-ALLOW-CACHE:YES\n#EXT-X-TARGETDURATION:2\n"
        + "#EXTINF:1.024000,\npart00.wav\n#EXTINF:1.024000,\npart01.wav\n#EXTINF:0.952000,\npart02.wav\n#EXT-X-ENDLIST\n");
    const samples = [0, 1, 2].map(index =>
      parseWav(volume.readFileSync(`/part0${index}.wav`) as Buffer).tracks[0]!.decodedAudio!.channelData[0]!);
    assert.deepEqual(samples.map(channel => channel.length), [8192, 8192, 7616]);
    assert.deepEqual(samples.flatMap(channel => Array.from(channel)),
      Array.from(parseWav(volume.readFileSync("/ramp.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!));
  });
}

it("derives the M3U8 target duration from actual segments", async () => {
  const volume = source();
  const result = await run(volume, "list.m3u8", ["-segment_time", "10"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(volume.readFileSync("/list.m3u8", "utf8"),
    "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-ALLOW-CACHE:YES\n#EXT-X-TARGETDURATION:3\n"
    + "#EXTINF:3.000000,\npart00.wav\n#EXT-X-ENDLIST\n");
});

it("protects an existing M3U8 list unless overwrite is requested", async () => {
  const volume = source();
  volume.writeFileSync("/list.m3u8", "keep");
  const before = volume.toJSON();
  assert.notEqual((await run(volume, "list.m3u8")).exitCode, 0);
  assert.deepEqual(volume.toJSON(), before);
  const result = await run(volume, "list.m3u8", ["-y"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(String(volume.readFileSync("/list.m3u8", "utf8")).startsWith("#EXTM3U\n"));
});

it("keeps playlist metadata and actual durations with a list window", async () => {
  const volume = source();
  const result = await run(volume, "list.m3u8", ["-segment_list_size", "1"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(volume.readFileSync("/list.m3u8", "utf8"),
    "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-MEDIA-SEQUENCE:2\n#EXT-X-ALLOW-CACHE:YES\n#EXT-X-TARGETDURATION:1\n"
    + "#EXTINF:0.952000,\npart02.wav\n#EXT-X-ENDLIST\n");
});
