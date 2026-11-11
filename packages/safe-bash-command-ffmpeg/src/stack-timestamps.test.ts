import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Byte-for-byte reference results from native FFmpeg, with two 2x2 gray frames per input.
for (const filter of ["hstack", "vstack"]) {
  for (const rates of [[1, 2], [2, 1], [1, 1]]) {
    for (const shortest of [false, true]) {
      it(`${filter} synchronizes ${rates.join("/")} fps inputs with shortest=${shortest}`, async () => {
        const volume = Volume.fromJSON({
          "/a.raw": Buffer.from([1, 2, 3, 4, 10, 20, 30, 40]),
          "/b.raw": Buffer.from([5, 6, 7, 8, 55, 66, 77, 88])
        });
        const stdout: Uint8Array[] = [];
        const stderr: Uint8Array[] = [];
        const args = ["-hide_banner", "-loglevel", "error",
          "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2", "-r", String(rates[0]), "-i", "/a.raw",
          "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2", "-r", String(rates[1]), "-i", "/b.raw",
          "-filter_complex", `[0:v][1:v]${filter}${shortest ? "=shortest=1" : ""}[out]`,
          "-map", "[out]", "-fps_mode", "passthrough", "-frames:v", "6"];
        for (const output of [["-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"], ["/out.mp4"]]) {
          const result = await createFfmpegCommand().execute({
            args: [...args, ...output],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async stat(path: string) { return volume.statSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
        }
        const initial = filter === "hstack" ? "0102050603040708" : "0102030405060708";
        const final = filter === "hstack" ? "0a1437421e284d58" : "0a141e2837424d58";
        const middle = rates[0] === 1
          ? filter === "hstack" ? "0102374203044d58" : "0102030437424d58"
          : filter === "hstack" ? "0a1405061e280708" : "0a141e2805060708";
        const expected = rates[0] === rates[1] ? initial + final
          : initial + middle + (shortest ? "" : final);
        assert.equal(Buffer.concat(stdout).toString("hex"), expected);
        const doc = parseMp4(volume.readFileSync("/out.mp4") as Buffer);
        const track = doc.tracks.find(track => track.type === "video")!;
        const timestamps = rates[0] === rates[1] ? [0, 1] : shortest ? [0, 0.5] : [0, 0.5, 1];
        assert.deepEqual(track.samples.map(sample => sample.pts / track.timescale), timestamps);
        assert.equal(doc.durationSeconds, shortest && rates[0] !== rates[1] ? 1 : 2);
      });
    }
  }
}

// Native FFmpeg 7.0.2 stops framesync before reusing an exhausted input.
for (const filter of ["hstack", "vstack", "xstack"]) {
  for (const [rate, shortest, expected] of [
    [3, true, "0a0b64650a0b6e6f"],
    [2, true, "0a0b646514156e6f"],
    [3, false, "0a0b64650a0b6e6f14156e6f1e1f6e6f"]
  ] as const) {
    it(`${filter} honors native EOF at 2/${rate} fps with shortest=${shortest}`, async () => {
      const volume = Volume.fromJSON({
        "/a.gray": Buffer.from([10, 11, 20, 21, 30, 31]),
        "/b.gray": Buffer.from([100, 101, 110, 111])
      });
      const stdout: Uint8Array[] = [];
      const stderr: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error",
          "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x1", "-framerate", "2", "-i", "/a.gray",
          "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x1", "-framerate", String(rate), "-i", "/b.gray",
          "-filter_complex", `[0:v][1:v]${filter}${shortest ? "=shortest=1" : ""}[out]`,
          "-map", "[out]", "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
      assert.equal(Buffer.concat(stdout).toString("hex"), expected);
    });
  }
}
