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

const input = "111c27323d48535e69747f8a";
for (const [filter, expected, bytes = input, format = "yuv420p", size = "4x2"] of [
  // FFmpeg 7.0.2 reference output: limited-range negval includes minval.
  ["null", input],
  ["lutyuv=y=negval", "eadfd4c9beb3a89d69747f8a"],
  ["lutyuv=y=maxval-val", "dacfc4b9aea3988d69747f8a"],
  ["lutyuv=u=minval", "111c27323d48535e10107f8a"],
  ["lutyuv=v=maxval", "111c27323d48535e6974f0f0"],
  ["lutyuv=negval", "eadfd4c9beb3a89d69747f8a"],
  ["lutyuv=c0=negval:c1=minval", "eadfd4c9beb3a89d10107f8a"],
  ["lutyuv=y=w+h", "060606060606060669747f8a"],
  ["lutyuv=y=negval,lutyuv=y=negval", input],
  ["lutyuv=u=minval,extractplanes=u", "1010", input, "gray"],
  ["lutyuv", "1010ebeb10f0", "000febff00ff", "yuv420p", "2x2"],
  ["lutyuv=y=val:u=val:v=val", "000febff00ff", "000febff00ff", "yuv420p", "2x2"],
  ["lutyuv=y=negval:u=negval:v=negval", "ebeb1010f010", "000febff00ff", "yuv420p", "2x2"],
  ["lutyuv=y=val*2:u=-1:v=999", "22384e647a90a6bc0000ffff"],
  ["lutyuv=u=minval", "11223344556610101010aabbccdd", "11223344556677889900aabbccdd", "yuv422p", "3x2"],
  ["lutyuv=u=minval", "112233441010101099aabbcc", "112233445566778899aabbcc", "yuv444p", "2x2"],
  ["lutyuv=y=negval", "eadfd4c96974007f80ff", "111c27326974007f80ff", "yuva420p", "2x2"],
  ["lutyuv=a=negval", "111c27326974ff807f00", "111c27326974007f80ff", "yuva420p", "2x2"],
  ["lutyuv=y=unknown", null],
  ["lutyuv=y=val/", null],
  ["lutyuv=y=0/0", null],
  ["lutyuv=unknown=val", null]
] as const) {
  it(`matches YUV lookup ${filter} (${format}, ${size})`, async () => {
    const volume = Volume.fromJSON({ "/out.raw": "preserved" });
    volume.writeFileSync("/in.raw", Buffer.from(bytes, "hex"));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo",
        "-pixel_format", format === "gray" ? "yuv420p" : format, "-video_size", size,
        "-framerate", "1", "-i", "/in.raw", "-vf", filter, "-frames:v", "1",
        "-pix_fmt", format, "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(data: Uint8Array) { errors.push(data); } }
    } as never);
    if (expected === null) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(Buffer.concat(errors).toString().includes("lutyuv:"));
      assert.equal(volume.readFileSync("/out.raw", "utf8"), "preserved");
    } else {
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.equal(Buffer.concat(errors).toString(), "");
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
    }
    assert.equal((volume.readFileSync("/in.raw") as Buffer).toString("hex"), bytes);
  });
}
