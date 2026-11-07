import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseAudio } from "@poe-code/audio-ast";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const audio = readFileSync(new URL("./fixtures/metadata-16.flac", import.meta.url));
const art = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEklEQVR4nGP8w4AdsOAQH6QSANBkARqrv8JBAAAAAElFTkSuQmCC", "base64");

for (const attached of [true, false]) {
  it(`FLAC ${attached ? "attaches marked" : "omits unmarked"} mapped PNG streams`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.flac", audio);
    volume.writeFileSync("/cover.png", art);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.flac", "-i", "/cover.png", "-map", "0:a", "-map", "1:v", "-c", "copy",
        ...(attached ? ["-disposition:v:0", "attached_pic"] : []), "/out.flac"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = volume.readFileSync("/out.flac") as Buffer;
    const parsed = parseAudio(output);
    assert.equal(parsed.pictures.length, attached ? 1 : 0);
    if (attached) assert.deepEqual(Buffer.from(parsed.pictures[0]!.data), art);
    assert.deepEqual(parsed.nodes.find(node => node.type === "FRAMES")!.data,
      parseAudio(audio).nodes.find(node => node.type === "FRAMES")!.data);
    if (spawnSync("ffprobe", ["-version"]).status === 0) {
      const probe = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", "pipe:0"], { input: output });
      assert.equal(probe.status, 0, probe.stderr.toString());
      const streams = JSON.parse(probe.stdout.toString()).streams;
      assert.equal(streams.length, attached ? 2 : 1);
      if (attached) {
        assert.equal(streams[1].codec_name, "png");
        assert.equal(streams[1].width, 8);
        assert.equal(streams[1].height, 8);
        assert.equal(streams[1].disposition.attached_pic, 1);
      }
    }
    if (spawnSync("ffmpeg", ["-version"]).status === 0) {
      for (const [input, map, format] of [[audio, "0:a", "s16le"], ...(attached ? [[art, "0:v", "rawvideo"] as const] : [])] as const) {
        const options = ["-v", "error", "-i", "pipe:0", "-map", map, ...(format === "rawvideo" ? ["-pix_fmt", "rgb24"] : []), "-f", format, "pipe:1"];
        const expected = spawnSync("ffmpeg", options, { input });
        const actual = spawnSync("ffmpeg", options, { input: output });
        assert.equal(expected.status, 0, expected.stderr.toString());
        assert.equal(actual.status, 0, actual.stderr.toString());
        assert.equal(createHash("sha256").update(actual.stdout).digest("hex"), createHash("sha256").update(expected.stdout).digest("hex"));
      }
    }
  });
}
