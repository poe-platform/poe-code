import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [chroma, format, depth] of [["444", "yuv444p", 8], ["444p10", "yuv444p10le", 10], ["444p16", "yuv444p16le", 16]] as const) {
  it(`tblend average preserves ${format} samples and rounds down`, async () => {
    const samples = [[50, 30, 212], [120, 180, 60], [120, 180, 60], [81, 141, 191]];
    const multiplier = 2 ** (depth - 8);
    const plane = (value: number) => {
      const bytes = Buffer.alloc(4 * (depth === 8 ? 1 : 2));
      for (let i = 0; i < 4; i++) {
        if (depth === 8) bytes[i] = value;
        else bytes.writeUInt16LE(value, i * 2);
      }
      return bytes;
    };
    const input = Buffer.concat([Buffer.from(`YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C${chroma}\n`),
      ...samples.flatMap(frame => [Buffer.from("FRAME\n"), ...frame.map(value => plane(value * multiplier))])]);
    const volume = Volume.fromJSON({ "/in.y4m": input, "/o.raw": "KEEP" });
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", "tblend=all_mode=average", "-fps_mode", "passthrough", "-pix_fmt", format, "-f", "rawvideo", "/o.raw"],
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
    assert.deepEqual(volume.readFileSync("/o.raw"), Buffer.concat(samples.slice(1).flatMap((frame, index) =>
      frame.map((value, channel) => plane(Math.floor((value + samples[index]![channel]!) * multiplier / 2))))));
  });
}

for (const filter of ["tblend=all_mode=average", "tblend=all_mode=average,select='eq(t,0.5)'"]) {
  it(`${filter} averages rgba samples including alpha with the current timestamp`, async () => {
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
    assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat(frames.slice(1).map((frame, index) => frame.map((value, offset) => Math.floor((value + frames[index]![offset]!) / 2))).filter((_, index) => !filter.includes("select") || index === 1)));
  });
}
