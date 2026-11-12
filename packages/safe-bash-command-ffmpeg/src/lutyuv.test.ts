import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const source = "111c27323d48535e69747f8a";
for (const [format, input, filter, expected] of [
  ["yuv422p", "111c27323d48535e69747f8a95a0abb6", "lutyuv=u=negval", "111c27323d48535e978c817695a0abb6"],
  ["yuv444p", "111c27323d48535e69747f8a95a0abb6c1ccd7e2edf8030e", "lutyuv=v=minval", "111c27323d48535e69747f8a95a0abb61010101010101010"],
  ["yuva420p", "111c27323d48535e69747f8a000f10ebecfdfeff", "lutyuv=a=negval", "111c27323d48535e69747f8afff0ef1413020100"],
  ["yuv420p", "000f10ebecfdfeff000fffff", "lutyuv", "101010ebebebebeb1010f0f0"],
  ["yuv420p", "000f10ebecfdfeff000fffff", "lutyuv=y=negval", "ebebeb10101010101010f0f0"],
  ["yuv420p", "000f10ebecfdfeff000fffff", "lutyuv=y=maxval-val", "ebdcdb00000000001010f0f0"],
  ["yuv420p", "000f10ebecfdfeff000fffff", "lutyuv=y=val", "000f10ebecfdfeff1010f0f0"],
  ["yuv420p", source, "null", source],
  ["yuv420p", source, "lutyuv=y=negval", "eadfd4c9beb3a89d69747f8a"],
  ["yuv420p", source, "lutyuv=y=maxval-val", "dacfc4b9aea3988d69747f8a"],
  ["yuv420p", source, "lutyuv=u=minval", "111c27323d48535e10107f8a"],
  ["yuv420p", source, "lutyuv=v=maxval", "111c27323d48535e6974f0f0"],
  ["yuv420p", source, "lutyuv=c1=minval:c2=maxval", "111c27323d48535e1010f0f0"],
  ["yuv420p", source, "lutyuv=y=gammaval(1)", source],
  ["yuv420p", source, "lutyuv=y=negval:enable=0", source],
  ["yuv420p", source, "lutyuv=y=negval,lutyuv=y=negval", source],
] as const) {
  it(`matches native ${format} ${filter}`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex") });
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pixel_format", format,
        "-video_size", "4x2", "-framerate", "1", "-i", "/in.raw", "-vf", filter,
        "-frames:v", "1", "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); } },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal(Buffer.concat(output).toString("hex"), expected);
    assert.equal((volume.readFileSync("/in.raw") as Buffer).toString("hex"), input);
  });
}
