import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Raw bytes and showinfo dimensions from native Linux FFmpeg 7.0.2.
for (const [format, height, size, field, outputHeight, expected] of [
  ["gray", 1, 2, "top", 1, "0d14"],
  ["gray", 3, 6, "top", 2, "0d142930"],
  ["gray", 3, 6, "bottom", 1, "1b22"],
  ["gray", 5, 10, "top", 3, "0d142930454c"],
  ["gray", 5, 10, "bottom", 2, "1b22373e"],
  ["gray16be", 1, 4, "top", 1, "0d141b22"],
  ["gray16be", 3, 12, "top", 2, "0d141b22454c535a"],
  ["gray16be", 3, 12, "bottom", 1, "2930373e"],
  ["gray16be", 5, 20, "top", 3, "0d141b22454c535a7d848b92"],
  ["gray16be", 5, 20, "bottom", 2, "2930373e61686f76"],
  ["rgba", 1, 8, "top", 1, "0d141b222930373e"],
  ["rgba", 3, 24, "top", 2, "0d141b222930373e7d848b9299a0a7ae"],
  ["rgba", 3, 24, "bottom", 1, "454c535a61686f76"],
  ["rgba", 5, 40, "top", 3, "0d141b222930373e7d848b9299a0a7aeedf4fb020910171e"],
  ["rgba", 5, 40, "bottom", 2, "454c535a61686f76b5bcc3cad1d8dfe6"],
  ["yuv420p", 1, 4, "top", 1, "0d141b22"],
  ["yuv420p", 3, 10, "top", 2, "0d1429303745"],
  ["yuv420p", 3, 10, "bottom", 1, "1b223e4c"],
  ["yuv420p", 5, 16, "top", 3, "0d142930454c53616876"],
  ["yuv420p", 5, 16, "bottom", 2, "1b22373e5a6f"],
  ["yuv444p", 1, 6, "top", 1, "0d141b222930"],
  ["yuv444p", 3, 18, "top", 2, "0d142930373e535a61687d84"],
  ["yuv444p", 3, 18, "bottom", 1, "1b22454c6f76"],
  ["yuv444p", 5, 30, "top", 3, "0d142930454c535a6f768b9299a0b5bcd1d8"],
  ["yuv444p", 5, 30, "bottom", 2, "1b22373e61687d84a7aec3ca"]
] as const) {
  it(`extracts the ${field} field from 2x${height} ${format} without dropping scanlines`, async () => {
    const input = Buffer.from(Array.from({ length: size }, (_, i) => (13 + i * 7) % 256));
    const volume = Volume.fromJSON({ "/in.raw": input });
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", format,
        "-s", `2x${height}`, "-i", "/in.raw", "-vf", `field=${field},showinfo`,
        "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.ok(stderr.includes(`s:2x${outputHeight} `), stderr);
    assert.equal(Buffer.concat(stdout).toString("hex"), expected);
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
  });
}
