import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 output for three 2x2 fields at 4 fps.
for (const [format, filter, inputHex, outputHex] of [
  ["rgb48", "weave=top",
    "11589fe62d74bb024990d71e65acf33a81c80f569de42b72b900478ed51c63aaf1387fc60d549be22970b7fe458cd31a61a8ef367dc40b5299e0276eb5fc438ad1185fa6ed347bc2",
    "11589fe62d74bb024990d71eb900478ed51c63aaf1387fc665acf33a81c80f569de42b720d549be22970b7fe458cd31a"],
  ["rgba64", "doubleweave=bottom",
    "11589fe62d74bb024990d71e65acf33a81c80f569de42b72b900478ed51c63aaf1387fc60d549be22970b7fe458cd31a61a8ef367dc40b5299e0276eb5fc438ad1185fa6ed347bc2095097de256cb3fa4188cf165da4eb3279c0074e95dc236a",
    "f1387fc60d549be22970b7fe458cd31a11589fe62d74bb024990d71e65acf33a61a8ef367dc40b5299e0276eb5fc438a81c80f569de42b72b900478ed51c63aaf1387fc60d549be22970b7fe458cd31ad1185fa6ed347bc2095097de256cb3fa61a8ef367dc40b5299e0276eb5fc438a4188cf165da4eb3279c0074e95dc236a"]
] as const) {
  for (const [pixelFormat, vf, expected] of [
    [`${format}le`, filter, outputHex],
    [`${format}le`, "null", inputHex],
    [`${format}be`, filter, outputHex]
  ] as const) {
    it(`matches native ${vf} bytes for three ${pixelFormat} fields`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.from(inputHex, "hex") });
      const stdout: Uint8Array[] = [];
      const stderr: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "error", "-f", "rawvideo",
          "-pixel_format", pixelFormat, "-video_size", "2x2", "-framerate", "4", "-i", "/in.raw",
          "-vf", vf, "-fps_mode", "passthrough", "-pix_fmt", pixelFormat, "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0);
      assert.equal(Buffer.concat(stderr).toString(), "");
      assert.equal(Buffer.concat(stdout).toString("hex"), expected);
    });
  }
}
