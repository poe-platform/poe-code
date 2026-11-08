import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

async function run(args: string[], sync: boolean, files: Record<string, Buffer>) {
  const volume = Volume.fromJSON(files);
  let stderr = "";
  const result = sync ? evalSyncFfmpeg(args, undefined,
    path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
    (path, data) => { volume.writeFileSync(path, data); return true; }) : await createFfmpegCommand().execute({
    args, cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { volume, success: sync ? result === "" : (result as { exitCode: number }).exitCode === 0, stderr };
}


// Generated with native FFmpeg: -f lavfi -i sine=frequency=730:sample_rate=48000:duration=1 -c:a aac
// Native copy: 48 packets, PTS -1024..47104 (disabled), 0..48128 (both shifted modes).
const source = readFileSync(new URL("./fixtures/avoid-negative-ts.m4a", import.meta.url));

for (const sync of [false, true]) {
  for (const [mode, shift] of [["make_non_negative", 1024], ["make_zero", 1024], ["disabled", 0], ["auto", 0], ["1", 1024], ["2", 1024], ["0", 0], ["-1", 0], [undefined, 0]] as const) {
    it(`preserves AAC packets and applies ${mode ?? "default"} timestamps (sync=${sync})`, async () => {
      const result = await run(["-i", "/in.m4a", ...(mode === undefined ? [] : ["-avoid_negative_ts", mode]), "-c", "copy", "/out.m4a"], sync, { "/in.m4a": source });
      assert.ok(result.success, result.stderr);
      const output = parseMp4(result.volume.readFileSync("/out.m4a") as Buffer);
      const track = output.tracks[0]!;
      const input = parseMp4(source).tracks[0]!;
      assert.equal(track.samples.length, 48);
      assert.deepEqual(track.samples.map(packet => packet.data), input.samples.map(packet => packet.data));
      assert.deepEqual(track.samples.map(packet => packet.duration), input.samples.map(packet => packet.duration));
      let offset = 0;
      for (const edit of track.editList ?? []) {
        if (edit.mediaTime < 0) offset += edit.segmentDuration * track.timescale / output.timescale;
        else { offset -= edit.mediaTime; break; }
      }
      assert.deepEqual(track.samples.map(packet => packet.pts + offset), input.samples.map((_, i) => i * 1024 - 1024 + shift));
      assert.deepEqual(track.samples.map(packet => packet.dts + offset), input.samples.map((_, i) => i * 1024 - 1024 + shift));
    });
  }
  it(`rejects invalid avoid_negative_ts without overwriting output (sync=${sync})`, async () => {
    const result = await run(["-y", "-i", "/in.m4a", "-avoid_negative_ts", "invalid", "-c", "copy", "/out.m4a"], sync, { "/in.m4a": source, "/out.m4a": source });
    assert.equal(result.success, false);
    assert.deepEqual(result.volume.readFileSync("/out.m4a"), source);
  });
}

for (const sync of [false, true]) {
  for (const mode of ["make_zero", "make_non_negative"]) {
    it(`handles positive start times with ${mode} (sync=${sync})`, async () => {
      const doc = parseMp4(source);
      const input = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({ ...track,
        editList: [{ segmentDuration: doc.timescale, mediaTime: -1, mediaRateInteger: 1, mediaRateFraction: 0 },
          { ...track.editList![0]!, mediaTime: 0 }]
      })) });
      const result = await run(["-copyts", "-i", "/in.m4a", "-avoid_negative_ts", mode, "-c", "copy", "/out.m4a"], sync, { "/in.m4a": Buffer.from(input) });
      assert.ok(result.success, result.stderr);
      const output = parseMp4(result.volume.readFileSync("/out.m4a") as Buffer);
      const track = output.tracks[0]!;
      assert.equal(track.samples.length, 48);
      assert.deepEqual(track.samples.map(packet => packet.data), doc.tracks[0]!.samples.map(packet => packet.data));
      assert.equal(track.editList?.[0]?.mediaTime, mode === "make_zero" ? 0 : -1);
      if (mode !== "make_zero") assert.equal(track.editList?.[0]?.segmentDuration, output.timescale);
    });
  }
}

it("resets avoid_negative_ts for the next output", async () => {
  const result = await run(["-i", "/in.m4a", "-avoid_negative_ts", "make_zero", "-c", "copy", "/shifted.m4a", "-c", "copy", "/original.m4a"], false, { "/in.m4a": source });
  assert.ok(result.success, result.stderr);
  assert.equal(parseMp4(result.volume.readFileSync("/shifted.m4a") as Buffer).tracks[0]!.editList![0]!.mediaTime, 0);
  assert.equal(parseMp4(result.volume.readFileSync("/original.m4a") as Buffer).tracks[0]!.editList![0]!.mediaTime, 1024);
});
