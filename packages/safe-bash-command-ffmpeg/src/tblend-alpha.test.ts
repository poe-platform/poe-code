import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Linux FFmpeg 7.0.2: packed alpha rounds during conversion to planar GBR before blending.
for (const [label, samples, difference] of [
  ["color and alpha", [[50, 30, 212, 255], [120, 180, 60, 128], [120, 180, 60, 128], [80, 140, 190, 32]],
    [[70, 150, 152, 126], [0, 0, 0, 0], [40, 40, 130, 97]]],
  ["alpha only", [[20, 40, 60, 0], [20, 40, 60, 200], [20, 40, 60, 200], [20, 40, 60, 128]],
    [[0, 0, 0, 201], [0, 0, 0, 0], [0, 0, 0, 72]]]
] as const) {
  for (const format of ["rgba", "bgra", "rgb24"]) {
    for (const [filter, expected] of [
      ["null", samples],
      ["tblend=all_mode=difference", difference],
      ["tblend=all_mode=difference,tblend=all_mode=difference", difference.filter((_, i) => i !== 1)]
    ] as const) {
      it(`${filter} preserves ${label} for ${format} input`, async () => {
        const input = Buffer.from(samples.flatMap(pixel => Array.from({ length: 4 }, () =>
          format === "bgra" ? [pixel[2]!, pixel[1]!, pixel[0]!, pixel[3]!] : pixel.slice(0, format === "rgb24" ? 3 : 4)).flat()));
        const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", format, "-video_size", "2x2", "-framerate", "4",
            "-i", "/in.raw", "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "/out.raw"],
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
        assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(expected.flatMap(pixel =>
          Array.from({ length: 4 }, () => format === "rgb24" ? [...pixel.slice(0, 3), 255] : pixel).flat())));
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
