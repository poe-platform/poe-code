import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { BitReader, decodeH264Samples, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg: 24 frames at 12 fps. -vf hflip -c:v libx264 -tune zerolatency
// retains every frame, emits no B-slices, and gives every packet equal PTS/DTS.
const input = readFileSync(new URL("./fixtures/h264-zerolatency-input.mp4", import.meta.url));

for (const filters of [[], ["-vf", "hflip"]]) {
  for (const tune of [undefined, "zerolatency", "zerolatencx", ""]) {
    it(`H.264 tune ${JSON.stringify(tune) ?? "default"} (${filters.join(" ") || "unfiltered"})`, async () => {
      const volume = Volume.fromJSON({ "/input.mp4": input, "/out.mp4": "KEEP" });
      const args = ["-y", "-v", "error", "-i", "/input.mp4", ...filters, "-c:v", "libx264",
        ...(tune === undefined ? [] : ["-tune", tune]), "/out.mp4"];
      const valid = tune === undefined || tune === "zerolatency";
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
      assert.equal(result.exitCode, valid ? 0 : 1, stderr);
      assert.deepEqual(volume.readFileSync("/input.mp4"), input);
      if (!valid) {
        assert.match(stderr, /tune/);
        assert.equal(volume.readFileSync("/out.mp4", "utf8"), "KEEP");
        return;
      }
      const track = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks.find(track => track.type === "video")!;
      assert.equal(track.codecDescriptions[0]!.codecName, "h264");
      assert.equal(track.samples.length, 24);
      if (tune === "zerolatency") {
        for (const [i, sample] of track.samples.entries()) {
          assert.equal(sample.pts, sample.dts, `packet ${i}`);
          assert.ok(Math.abs(sample.pts / track.timescale - i / 12) < 0.00002, `packet ${i} time`);
          const bits = new BitReader(sample.data.subarray(5));
          bits.readUE();
          assert.notEqual(bits.readUE() % 5, 1, `packet ${i} is not a B-slice`);
        }
      }
      const frames = [...decodeH264Samples(track.samples, track.codecDescriptions, track.width!, track.height!, track.timescale)];
      assert.equal(frames.length, 24);
    });
  }
}

it("defers synchronous tune encoding without overwriting output", () => {
  const volume = Volume.fromJSON({ "/input.mp4": input, "/out.mp4": "KEEP" });
  assert.equal(evalSyncFfmpeg(["-y", "-i", "/input.mp4", "-c:v", "libx264", "-tune", "zerolatency", "/out.mp4"], undefined,
    path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
    (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
  assert.equal(volume.readFileSync("/out.mp4", "utf8"), "KEEP");
});
