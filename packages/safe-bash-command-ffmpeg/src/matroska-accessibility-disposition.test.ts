import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native AAC fixture: the first audio track is default, the second hearing impaired.
const input = readFileSync(new URL("./fixtures/accessibility-audio.mkv", import.meta.url));
const source = parseMkv(input);
const nativeAvailable = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const packetHashes = [
  "191aef2a83911c49a1380d0d8da4ba9130ea6437c7e743160729d19123729c58",
  "26eae7a77abfc6b17741fbfe4d5a7bfb26d38fc0c9e3b4e039461793bb3ed29e"
];

for (const { value, flags } of [
  { value: undefined, flags: ["hearing_impaired"] },
  { value: "visual_impaired", flags: ["visual_impaired"] },
  { value: "-hearing_impaired", flags: [] },
  { value: "+comment", flags: ["comment", "hearing_impaired"] },
  { value: "+forced-hearing_impaired", flags: ["forced"] },
  { value: "hearing_impaired+visual_impaired", flags: ["hearing_impaired", "visual_impaired"] },
  { value: "+visual_impaired-hearing_impaired-visual_impaired", flags: [] }
]) {
  it(`copies Matroska audio with disposition ${value ?? "unchanged"}`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.mkv", input);
    const options = ["-map", "0:a", "-c", "copy", ...(value === undefined ? [] : ["-disposition:a:1", value])];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.mkv", ...options, "/out.mkv"],
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
    const tracks = parseMkv(output).tracks;
    const expected = [["default"], flags];
    assert.deepEqual(tracks.map(track => Object.keys(track.disposition ?? {}).filter(name => track.disposition![name]).sort()), expected);
    assert.deepEqual(tracks.map(track => track.samples.map(sample => Buffer.from(sample.data))),
      source.tracks.map(track => track.samples.map(sample => Buffer.from(sample.data))));
    assert.deepEqual(tracks.map(track => createHash("sha256").update(track.samples.map(sample =>
      `SHA256:${createHash("sha256").update(sample.data).digest("hex")}`).join("\n")).digest("hex")), packetHashes);
    if (nativeAvailable) {
      const native = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", ...options, "-f", "matroska", "pipe:1"], { input });
      assert.equal(native.status, 0, native.stderr.toString());
      for (const media of [native.stdout, output]) {
        const probe = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-show_packets", "-show_data_hash", "sha256", "-of", "json", "pipe:0"], { input: media });
        assert.equal(probe.status, 0, probe.stderr.toString());
        const { streams, packets } = JSON.parse(probe.stdout.toString()) as {
          streams: { index: number; disposition: Record<string, number> }[];
          packets: { stream_index: number; data_hash: string }[];
        };
        assert.deepEqual(streams.map(stream => Object.keys(stream.disposition).filter(name => stream.disposition[name]).sort()), expected);
        assert.deepEqual(streams.map(stream => createHash("sha256").update(packets.filter(packet =>
          packet.stream_index === stream.index).map(packet => packet.data_hash).join("\n")).digest("hex")), packetHashes);
      }
    }
  });
}
