import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const rgb = "052a4f7499bee3082d52779cc1e60b30557a9fc4e90e3358";
const rgba = rgb + "7da2c7ec11365b80";
const red = "fad54f7499bee308d2ad779cc1e60b30aa859fc4e90e3358825dc7ec11365b80";
const alpha = "052a4f7499be1cf72d52779cc1e6f4cf557a9fc4e90ecca77da2c7ec1136a47f";

// Native FFmpeg 7.0.2: packed 16-bit components, with no format conversion.
for (const [format, filter, input, expected] of [
  ["rgb48be", "null", rgb, rgb],
  ["rgb48be", "negate", rgb, "fad5b08b66411cf7d2ad88633e19f4cfaa85603b16f1cca7"],
  ["rgb48be", "negate,negate", rgb, rgb],
  ["rgb48be", "negate=components=r", rgb, "fad54f7499be1cf72d52779c3e190b30557a603be90e3358"],
  ["rgb48be", "negate=components=none", rgb, rgb],
  ["rgba64be", "null", rgba, rgba],
  ["rgba64be", "negate=components=r", rgba, red],
  ["rgba64be", "negate=components=a", rgba, alpha],
  ["rgba64be", "negate=components=none", rgba, rgba],
  ["rgba64be", "negate=components=g+b", rgba, "052ab08b6641e3082d5288633e190b30557a603b16f133587da23813eec95b80"],
  ["rgba64be", "negate,negate", rgba, rgba],
  ["rgba64be", "negate=components=r+a,negate=components=r+a", rgba, rgba],
  ["rgba64be", "negate=components=r:enable=0", rgba, rgba],
  ["rgba64be", "negate=components=r:enable=gte(n\\,1)", rgba.repeat(2), rgba + red],
  ["rgba64be", "sendcmd=c='0.25 negate@x components a',negate@x=components=r", rgba.repeat(2), red + alpha],
  ["rgba64be", "negate=components=r+a", "000000017fffffff8000fffe00ff0001ff000100fffe0000ffff8000000100ff",
    "ffff00017fff00007ffffffe00fffffe00ff0100fffeffff000080000001ff00"]
] as const) {
  for (const graph of [false, true]) {
    it(`preserves every ${format} component with ${filter} (${graph ? "graph" : "simple"}, ${input})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex") });
      const output: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "rawvideo", "-pixel_format", format, "-video_size", "2x2", "-framerate", "4",
          "-i", "/in.raw", ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", format, "-bitexact", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(output).toString("hex"), expected);
    });
  }
}
