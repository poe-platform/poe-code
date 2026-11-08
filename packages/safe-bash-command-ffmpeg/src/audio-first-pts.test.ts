import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [filter, frames, padding, discard] of [
  ["anull", 8, 0, 0],
  ["aresample=first_pts=-1600", 8, 1600, 0],
  ["aresample=first_pts=1600", 8, 0, 8],
  ["aresample=first_pts=0", 8, 0, 0],
  ["aresample=first_pts=-8", 8, 0, 0],
  ["aresample=first_pts=8", 8, 0, 0],
  ["aresample=first_pts=-9", 8, 9, 0],
  ["aresample=first_pts=1600", 2000, 0, 1600],
  ["atrim=start_sample=1600,aresample=first_pts=0", 2000, 1600, 1600]
] as const) {
  for (const [graph, channelCount] of [[false, 1], [false, 2], [true, 2]] as const) {
    it(`${filter} pads or discards leading PCM (${channelCount} channels, ${graph ? "graph" : "simple"})`, async () => {
      const channels = Array.from({ length: channelCount }, (_, c) =>
        Float64Array.from({ length: frames }, (_, i) =>
          (frames === 8 ? [100, -200, 300, -400, 500, -600, 700, -800][i]! : i) * (c ? -1 : 1) / 32768));
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      const actual = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      for (const [index, channel] of actual.channelData.entries()) {
        assert.equal(channel.length, frames + padding - discard);
        assert.deepEqual(Array.from(channel.subarray(padding)), Array.from(channels[index]!.subarray(discard)));
        assert.deepEqual(Array.from(channel.subarray(0, padding)), Array(padding).fill(0));
      }
    });
  }
}

for (const filter of ["aresample=first_pts=", "aresample=first_pts=bad",
  "aresample=first_pts=1.5", "aresample=first_pts=9007199254740992",
  "aresample=first_pts=-80000", "aresample=unknown=1", "aresample=first_pts=0:async=1"]) {
  it(`${filter} fails safely without replacing the destination`, async () => {
    const volume = Volume.fromJSON({ "/out.wav": "keep" });
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.25])] }));
    const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 1 } }).execute({
      args: ["-y", "-i", "/in.wav", "-af", filter, "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}
