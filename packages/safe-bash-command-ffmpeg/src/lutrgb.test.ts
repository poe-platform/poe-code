import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = "4080c0ff4080c0800a141e00ff002040";
for (const [filter, expected] of [
  ["lutrgb=a=negval", "4080c0004080c07f0a141effff0020bf"],
  ["lutrgb=c0=val/2", "2080c0ff2080c08005141e007f002040"],
  ["lutrgb=val/2", "2080c0ff2080c08005141e007f002040"],
  ["lutrgb=r=val/2", "2080c0ff2080c08005141e007f002040"],
  ["negate=components=a", "4080c0004080c07f0a141effff0020bf"],
  ["lutrgb", input],
  ["lutrgb=r=val/2:a=negval", "2080c0002080c07f05141eff7f0020bf"],
  ["lutrgb=g=maxval:b=minval", "40ff00ff40ff00800aff0000ffff0040"],
  ["lutrgb=r=val*2:g=-1", "8000c0ff8000c08014001e00ff002040"],
  ["lutrgb=r=w+h", "0480c0ff0480c08004141e0004002040"],
  ["lutrgb=r=unknown", null],
  ["lutrgb=r=val/", null],
  ["lutrgb=unknown=val", null]
] as const) {
  it(`matches FFmpeg ${filter}`, async () => {
    const volume = Volume.fromJSON({ "/out.raw": "preserved" });
    volume.writeFileSync("/in.raw", Buffer.from(input, "hex"));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba",
        "-s", "2x2", "-r", "1", "-i", "/in.raw",
        "-vf", filter, "-pix_fmt", "rgba", "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    if (expected === null) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(Buffer.concat(errors).toString().includes("lutrgb:"));
      assert.equal(volume.readFileSync("/out.raw", "utf8"), "preserved");
    } else {
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
    }
    assert.equal((volume.readFileSync("/in.raw") as Buffer).toString("hex"), input);
  });
}

const timelineInput = "111c27323d48535e69747f8a95a0abb6c1ccd7e2edf8030e19242f3a45505b66717c87929da8b3bec9d4dfeaf5000b16";
const secondFrameInverted = "111c27323d48535e69747f8a95a0abb6c1ccd7e2edf8030ee6242fc54550a4667183879262a8b341c9d420eaf5ff0b16";
const allFramesInverted = "ee1c27cd3d48ac5e698b7f8a6aa0ab49c1cc28e2ed07030ee6242fc54550a4667183879262a8b341c9d420eaf5ff0b16";
for (const [filter, expected] of [
  ["null", timelineInput],
  ["lutrgb=r=negval", allFramesInverted],
  ["lutrgb=r=negval:enable=0", timelineInput],
  ["lutrgb=r=negval:enable=1", allFramesInverted],
  ["lutrgb=r=negval:enable=gte(n\\,1)", secondFrameInverted],
  ["lutrgb=r=negval:enable='gte(t,1)'", secondFrameInverted],
  ["lutrgb=r=negval:enable=0.49", timelineInput],
  ["lutrgb=r=negval:enable=-0.5", allFramesInverted],
  ["lutrgb=r=negval:enable=NAN", timelineInput],
  ["lutrgb=r=negval:enable='gte(st(0,ld(0)+1),3)'", secondFrameInverted],
  ["lutrgb=r=negval:enable=unknown", null],
  ["lutrgb=r=negval:enable=gte(n\\,)", null],
  ["lutrgb=r=unknown:enable=0", null]
] as const) {
  it(`matches FFmpeg timeline ${filter}`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": Buffer.from(timelineInput, "hex") });
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pixel_format", "rgb24",
        "-video_size", "4x2", "-framerate", "1", "-i", "/in.raw", "-vf", filter,
        "-frames:v", "2", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    if (expected === null) {
      assert.notEqual(result.exitCode, 0);
      assert.match(Buffer.concat(errors).toString(), /lutrgb/);
      assert.equal(Buffer.concat(output).length, 0);
    } else {
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.equal(Buffer.concat(errors).toString(), "");
      assert.equal(Buffer.concat(output).toString("hex"), expected);
    }
    assert.equal((volume.readFileSync("/in.raw") as Buffer).toString("hex"), timelineInput);
  });
}
