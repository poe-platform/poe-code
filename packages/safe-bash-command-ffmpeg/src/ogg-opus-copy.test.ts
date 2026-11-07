import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { readOgg } from "@poe-code/audio-ast";
import { oggAst, parseMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native fixtures: ffmpeg -f lavfi -i sine=f=440:r=48000:d=0.75 -c:a libopus -metadata title=Tone440 tone-opus.ogg
for (const chained of [false, true]) for (const sync of [false, true]) {
  it(`${sync ? "sync" : "async"} copies ${chained ? "chained" : "single"} Ogg Opus packets and metadata into Matroska`, async () => {
    const first = readFileSync(new URL("./fixtures/tone-opus.ogg", import.meta.url));
    const input = chained ? Buffer.concat([first, readFileSync(new URL("./fixtures/tone-opus-880.ogg", import.meta.url))]) : first;
    const volume = Volume.fromJSON({ "/in.ogg": input });
    const args = ["-y", "-v", "error", "-i", "/in.ogg", "-c", "copy", "/out.mkv"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
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
      assert.equal(result.exitCode, 0, stderr);
    }
    const copied = parseMkv(new Uint8Array(volume.readFileSync("/out.mkv") as Buffer));
    const track = copied.tracks[0]!;
    const packets = readOgg(input).packets.filter(packet => !["OpusHead", "OpusTags"].includes(new TextDecoder().decode(packet.data.subarray(0, 8))));
    assert.equal(track.samples.length, chained ? 76 : 38);
    assert.deepEqual(track.samples.map(sample => sample.data), packets.map(packet => packet.data));
    assert.equal(track.codecDelayNs, 6_500_000);
    assert.equal(track.seekPreRollNs, 80_000_000);
    assert.equal(track.samples[37]!.discardPaddingNs, 3_500_000);
    assert.ok(Math.abs(track.samples[0]!.pts + 6.5) <= 0.5);
    if (chained) assert.equal(track.samples[38]!.pts, 750);
    assert.equal(copied.metadata.title, "Tone440");
  });
}

// Native multiplex: ffmpeg -i tone-opus.ogg -i tone-opus-880.ogg -map 0:a -map 1:a -c copy two-opus.ogg
for (const [selected, format] of [[false, "mkv"], [false, "ogg"], [true, "ogg"]] as const) {
  it(`copies ${selected ? "second" : "both"} multiplexed Opus tracks into ${format}`, async () => {
    const input = readFileSync(new URL("./fixtures/two-opus.ogg", import.meta.url));
    const volume = Volume.fromJSON({ "/in.ogg": input });
    const output = `/out.${format}`;
    const args = ["-y", "-v", "error", "-i", "/in.ogg", "-map", selected ? "0:a:1" : "0", "-c", "copy", output];
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
    assert.equal(result.exitCode, 0, stderr);
    const bytes = new Uint8Array(volume.readFileSync(output) as Buffer);
    const copied = format === "ogg" ? oggAst().parse(bytes) : parseMkv(bytes);
    const source = readOgg(input).packets;
    const serials = [...new Set(source.map(packet => packet.serial))];
    assert.equal(copied.tracks.length, selected ? 1 : 2);
    for (const [index, track] of copied.tracks.entries()) {
      const sourceIndex = selected ? 1 : index;
      const packets = source.filter(packet => packet.serial === serials[sourceIndex]).slice(2);
      assert.equal(track.samples.length, 38);
      assert.deepEqual(track.samples.map(sample => sample.data), packets.map(packet => packet.data));
      assert.equal(track.metadata?.title, sourceIndex ? "Tone880" : "Tone440");
      assert.equal(track.codecDelayNs, 6_500_000);
      assert.equal(track.samples[37]!.discardPaddingNs, 3_500_000);
    }
  });
}
