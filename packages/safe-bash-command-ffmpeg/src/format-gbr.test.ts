import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [[50, 30, 212, 255], [120, 180, 60, 128], [120, 180, 60, 128], [80, 140, 190, 32]];

for (const [filter, alphas] of [
  ["format=gbrp", [255, 255, 255, 255]],
  ["format=gbrap", [255, 129, 129, 32]],
  ["format=pix_fmts=gbrap", [255, 129, 129, 32]],
  ["format=gbrap,format=gbrap", [255, 129, 129, 32]],
  ["format=gbrp,format=gbrap", [255, 255, 255, 255]],
  ["format=gbrap,format=gbrp", [255, 255, 255, 255]],
  ["format=gbrp|rgba", [255, 128, 128, 32]],
  ["format=gbrap|rgba", [255, 128, 128, 32]],
  ["format=rgba", [255, 128, 128, 32]],
] as const) {
  it(`${filter} matches FFmpeg 7 planar GBR color and alpha conversion`, async () => {
    const volume = Volume.fromJSON({ "/o.raw": "KEEP" });
    volume.writeFileSync("/in.rgba", Buffer.from(samples.flatMap(sample => Array.from({ length: 4 }, () => sample).flat())));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "2x2", "-framerate", "4",
        "-i", "in.rgba", "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "o.raw"],
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
    // Reference bytes from FFmpeg 7.0.2: GBR drops alpha; GBRA rounds 128 to 129.
    const expected = samples.flatMap((sample, index) =>
      Array.from({ length: 4 }, () => [...sample.slice(0, 3), alphas[index]!]).flat());
    assert.deepEqual(volume.readFileSync("/o.raw"), Buffer.from(expected));
  });
}
