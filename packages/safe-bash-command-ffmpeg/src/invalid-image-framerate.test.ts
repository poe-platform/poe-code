import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage } from "@poe-code/image-ast/portable";
import { decodeH264Samples, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const png = encodeImage({
  width: 16, height: 16, channels: 4,
  data: Uint8Array.from({ length: 16 * 16 * 4 }, (_, i) => i % 4 === 0 || i % 4 === 3 ? 255 : 0),
  format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
}, { format: "png" }).data;

for (const sync of [false, true]) {
  for (const rate of ["broken", "0", "-1", "25junk", "1/0", "1/2/3", "NaN", "Infinity", "", undefined]) {
    if (sync && rate === undefined) continue;
    it(`${sync ? "sync" : "async"} image input rate ${JSON.stringify(rate) ?? "default"}`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/f00.png", png);
      volume.writeFileSync("/f01.png", png);
      const before = volume.toJSON();
      const args = ["-y", ...(rate === undefined ? [] : ["-framerate", rate]), "-i", "/f%02d.png", "-c:v", "libx264", "/out.mp4"];
      const valid = rate === undefined;
      if (sync) {
        let reads = 0;
        const result = evalSyncFfmpeg(args, undefined,
          path => { reads++; return volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined; },
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        assert.equal(result, undefined);
        assert.equal(reads, 0, "invalid rate must be rejected before reading input");
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
        assert.equal(result.exitCode, valid ? 0 : 1, stderr);
        if (!valid) assert.ok(stderr.includes("Invalid framerate"), stderr);
      }
      if (!valid) {
        assert.deepEqual(volume.toJSON(), before);
      } else {
        assert.deepEqual(volume.readdirSync("/"), ["f00.png", "f01.png", "out.mp4"]);
        const track = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks.find(track => track.type === "video")!;
        const frames = [...decodeH264Samples(track.samples, track.codecDescriptions, 16, 16, track.timescale)];
        assert.equal(frames.length, 2);
        assert.equal(frames[0]!.ptsSeconds, 0);
        assert.equal(frames[1]!.ptsSeconds, 1 / 25);
      }
    });
  }
}
