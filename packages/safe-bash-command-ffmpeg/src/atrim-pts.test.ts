import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const channels of [1, 2]) {
  for (const [filter, start, end, frames] of [
    ["atrim=start_pts=", -1, 0, []],
    ["atrim=start_pts=invalid", -1, 0, []],
    ["atrim=start_pts=Infinity", -1, 0, []],
    ["atrim=start_pts=9007199254740992", 16, 16, []],
    ["atrim=end_pts=", -1, 0, []],
    ["atrim=end_pts=invalid", -1, 0, []],
    ["atrim=end_pts=Infinity", -1, 0, []],
    ["atrim=end_pts=9007199254740992", 0, 16, [[0, 16]]],
    ["atrim=start_pts=2:end_pts=8", 2, 8, [[2, 6]]],
    ["atrim=start_pts=2", 2, 16, [[2, 14]]],
    ["atrim=end_pts=8", 0, 8, [[0, 8]]],
    ["asetpts=PTS+8,atrim=start_pts=10:end_pts=16", 2, 8, [[10, 6]]],
    ["asetpts=PTS+8,atrim=start_sample=2:end_sample=8", 2, 8, [[10, 6]]],
    ["asetpts=PTS-8,atrim=start_pts=-6:end_pts=0", 2, 8, [[-6, 6]]],
    ["asetpts=PTS+8,atrim=end_pts=4", 0, 0, []],
    ["atrim=start_pts=32", 16, 16, []],
    ["atrim=start_pts=8:end_pts=8", 8, 8, []],
    ["asetnsamples=4:0,asetpts=2*PTS+8,atrim=start_pts=10:end_pts=20", 2, 8, [[10, 2], [16, 4]]],
    ["asetnsamples=4:0,asetpts=2*PTS+8,atrim=start_pts=14:end_pts=18", 4, 6, [[16, 2]]],
    ["asetnsamples=4:0,asetpts=2*PTS+8,atrim=start_pts=10:start_sample=1:end_pts=20:end_sample=6", 1, 8, [[9, 3], [16, 4]]],
    ["asetpts=PTS+8,atrim=start_sample=2,atrim=start_pts=12:end_pts=16", 4, 8, [[12, 4]]],
    ["asetpts=PTS+8,atrim=start_pts=10,atrim=start_sample=2:end_sample=6", 4, 8, [[12, 4]]],
    ["asetpts=PTS+8,atrim=start_pts=10,asetpts=PTS-STARTPTS,atrim=end_pts=4", 2, 6, [[0, 4]]]
  ] as const) {
    it(`${filter} keeps timestamped PCM frames with ${channels} channels`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: Array.from({ length: channels }, (_, c) =>
        Float64Array.from({ length: 16 }, (_, i) => (c ? -1 : 1) * (i + 1) / 32768)) });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.wav": "existing" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", "-y", "-i", "/in.wav", "-af", `${filter},ashowinfo`, "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (start === -1) {
        assert.equal(result.exitCode, 1, stderr);
        assert.ok(stderr.includes("atrim: invalid"), stderr);
        assert.equal(volume.readFileSync("/out.wav", "utf8"), "existing");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      for (let c = 0; c < channels; c++) {
        assert.deepEqual(Array.from(audio.channelData[c]!, value => value * 32768),
          Array.from({ length: end - start }, (_, i) => (c ? -1 : 1) * (start + i + 1)));
      }
      const actualFrames = stderr.split("\n").filter(line => line.includes("nb_samples:")).map(line => {
        const fields = line.split(" ");
        return [Number(fields.find(field => field.startsWith("pts:"))!.slice(4)),
          Number(fields.find(field => field.startsWith("nb_samples:"))!.slice(11))];
      });
      assert.deepEqual(actualFrames, frames);
    });
  }
}

for (const complex of [false, true]) {
  for (const [filter, expected] of [
    ["asetpts=NAN,atrim=end_pts=4", [1, 2, 3, 4]],
    ["asetpts=0/0,atrim=end_pts=4", [1, 2, 3, 4]],
    ["asetnsamples=3:0,asetpts=NAN,atrim=end_pts=4", [1, 2, 3, 4]],
    ["asetnsamples=3:0,asetpts=PTS,atrim=end_pts=4", [1, 2, 3, 4]],
    ["asetnsamples=3:0,asetpts=NAN,atrim=start_pts=2:end_pts=5", [3, 4, 5]],
    ["asetnsamples=3:0,asetpts=NAN,atrim=start=0.00025:duration=0.000375", [3, 4, 5]],
    ["asetnsamples=3:0,asetpts=if(eq(N\\,0)\\,8\\,NAN),atrim=end_pts=12", [1, 2, 3, 4]],
    ["asetpts=NAN,asetpts=if(isnan(PTS)\\,N\\,PTS),atrim=end_pts=4", [1, 2, 3, 4]]
  ] as const) {
    it(`${complex ? "complex" : "simple"} ${filter} retains PCM with absent timestamps`, async () => {
      const input = Buffer.alloc(24);
      for (let i = 0; i < 12; i++) input.writeInt16LE(i + 1, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
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
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
    });
  }
}
