import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const format of ["rgba", "gray16be", "rgb48be", "rgba64be", "yuv444p", "yuv420p"]) {
  for (const [action, value, width, height, x, y] of [
    ["x", "2", 2, 2, 2, 0], ["y", "2", 2, 2, 0, 2],
    ["w", "iw", 4, 2, 0, 0], ["out_w", "iw", 4, 2, 0, 0],
    ["h", "ih", 2, 4, 0, 0], ["out_h", "ih", 2, 4, 0, 0]
  ] as const) {
    it(`timed crop preserves ${format} samples when changing ${action}`, async () => {
      const planar = format.startsWith("yuv");
      const stride = planar ? 1 : format === "rgba" ? 4 : format === "gray16be" ? 2 : format === "rgb48be" ? 6 : 8;
      const input: number[] = [];
      const expected: number[] = [];
      for (let frame = 0; frame < 3; frame++) {
        for (let plane = 0; plane < (planar ? 3 : 1); plane++) {
          const sub = format === "yuv420p" && plane > 0 ? 2 : 1;
          for (let row = 0; row < 4 / sub; row++) {
            for (let column = 0; column < 4 / sub; column++) {
              const i = frame * 16 + row * (4 / sub) + column;
              const pixel = planar ? [16 + plane * 60 + i] : format === "rgba" ? [16 + i, 32 + i, 64 + i, 128 + i]
                : [0x1234, 0x4567, 0x89ab, 0xbdef].slice(0, stride / 2).flatMap(v => [(v + i) >> 8, (v + i) & 255]);
              input.push(...pixel);
              const left = frame === 0 ? 0 : x / sub;
              const top = frame === 0 ? 0 : y / sub;
              if (column >= left && column < left + (frame === 0 ? 2 : width) / sub &&
                  row >= top && row < top + (frame === 0 ? 2 : height) / sub) expected.push(...pixel);
            }
          }
        }
      }
      const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input), "/out.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", format,
          "-video_size", "4x4", "-framerate", "4", "-i", "/in.raw", "-vf",
          `sendcmd=c='0.25 crop@c ${action} ${value}',crop@c=2:2:0:0`,
          "-fps_mode", "passthrough", "-pix_fmt", format, "-f", "rawvideo", "/out.raw"],
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
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(expected));
      assert.deepEqual(volume.readFileSync("/in.raw"), Buffer.from(input));
    });
  }
}
