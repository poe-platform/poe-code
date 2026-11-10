import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [filter, channel] of [["tblend=c0_mode=difference", 1], ["tblend=difference", 1], ["tblend=c1_mode=difference", 2], ["tblend=c2_mode=difference", 0], ["tblend=c3_mode=average", 3]] as const) {
  it(`${filter} changes only its GBR(A) component`, async () => {
    const samples = [[50, 30, 212, 255], [120, 180, 60, 128], [120, 180, 60, 128], [80, 140, 190, 32]];
    const frames = samples.map(sample => Buffer.from(Array.from({ length: 4 }, () => sample).flat()));
    const input = Buffer.concat(frames);
    const volume = Volume.fromJSON({ "/in": input, "/out.raw": "KEEP" });
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "2x2", "-framerate", "4",
      "-i", "/in", "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "/out.raw"],
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
    assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat(frames.slice(1).map((frame, index) => frame.map((value, offset) => offset % 4 !== channel ? value : channel === 3 ? Math.floor((value + frames[index]![offset]!) / 2) : Math.abs(value - frames[index]![offset]!)))));
  });
}
