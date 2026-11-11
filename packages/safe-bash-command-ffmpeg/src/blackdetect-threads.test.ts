import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: scheduling options preserve these bytes and interval events.
for (const option of ["", ":threads=1", ":threads=0", ":threads=2147483647",
  ":threads=default", ":threads=min", ":threads=max", ":threads=1+1", ":threads=0.5",
  ":threads=1:threads=2:"]) {
  it(`preserves raw frames and ordered black intervals with ${option || "default threads"}`, async () => {
    const input = Buffer.from("00000000ffff00ff01010000dcdc0000", "hex");
    const volume = Volume.fromJSON({ "/in.raw": input });
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-v", "info", "-f", "rawvideo", "-pixel_format", "gray",
        "-video_size", "2x1", "-framerate", "4", "-i", "in.raw",
        "-vf", `blackdetect=d=0:pix_th=0.01${option}`,
        "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
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
    const error = Buffer.concat(errors).toString();
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(Buffer.concat(output), input);
    assert.deepEqual(error.trimEnd().split("\n"), [
      "black_start:0 black_end:0.5 black_duration:0.5",
      "black_start:1 black_end:1.5 black_duration:0.5",
      "black_start:1.75 black_end:1.75 black_duration:0"
    ]);
  });
}

for (const option of ["threads=-1", "threads=2147483648", "threads=", "threads=bogus",
  "threads=NaN", "threads=Infinity", "threads=-1:threads=1", "threads=1:unknown=1"]) {
  it(`rejects blackdetect ${option} before replacing output`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": Buffer.from([0, 255]), "/out.raw": "KEEP" });
    const before = volume.toJSON();
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x1",
        "-i", "in.raw", "-vf", `blackdetect=d=0:${option}`, "-pix_fmt", "gray", "-f", "rawvideo", "out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.ok(Buffer.concat(errors).toString().includes("blackdetect:"));
    assert.deepEqual(volume.toJSON(), before);
  });
}
