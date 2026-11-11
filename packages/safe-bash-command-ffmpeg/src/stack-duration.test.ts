import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast/portable";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const filter of ["hstack", "vstack"]) {
  for (const durations of [[2, 4], [4, 2]]) {
    for (const option of ["", ":shortest=0", ":shortest=1", ":1", ":shortest=0:shortest=1", ":shortest=1:shortest=0"]) {
      it(`${filter} ${durations.join("/")} seconds with ${option || "defaults"} preserves frames and timing`, async () => {
        const volume = Volume.fromJSON({});
        const errors: Uint8Array[] = [];
        const args = ["-y", "-v", "error",
          "-f", "lavfi", "-i", `color=c=red:s=8x8:r=1:d=${durations[0]}`,
          "-f", "lavfi", "-i", `color=c=green:s=8x8:r=1:d=${durations[1]}`,
          "-filter_complex", `[0:v][1:v]${filter}=${option === ":1" ? "2" : "inputs=2"}${option}`];
        const count = option.endsWith(":shortest=1") || option === ":1" ? 2 : 4;
        for (const output of ["/out_%d.png", "/out.mp4"]) {
          const result = await createFfmpegCommand().execute({
            args: [...args, output], cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        }
        assert.equal(Buffer.concat(errors).toString(), "");
        assert.equal(volume.existsSync(`/out_${count + 1}.png`), false);
        for (let i = 1; i <= count; i++) {
          const frame = decodeImage(volume.readFileSync(`/out_${i}.png`) as Buffer);
          assert.equal(frame.width, filter === "hstack" ? 16 : 8);
          assert.equal(frame.height, filter === "vstack" ? 16 : 8);
          assert.deepEqual([...frame.data.subarray(0, 4)], [253, 0, 0, 255]);
          const offset = filter === "hstack" ? 8 * 4 : 8 * 8 * 4;
          assert.deepEqual([...frame.data.subarray(offset, offset + 4)], [0, 127, 0, 255]);
        }
        const doc = parseMp4(volume.readFileSync("/out.mp4") as Buffer);
        const track = doc.tracks.find((track) => track.type === "video")!;
        assert.equal(track.samples.length, count);
        assert.deepEqual(track.samples.map((sample) => sample.pts / track.timescale),
          Array.from({ length: count }, (_, i) => i));
        assert.equal(doc.durationSeconds, count);
      });
    }
  }
}
