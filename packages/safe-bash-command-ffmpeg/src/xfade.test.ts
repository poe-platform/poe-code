import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const nativeAvailable = spawnSync("ffmpeg", ["-version"]).status === 0;
const inputs = ["-f", "lavfi", "-i", "color=c=red:s=16x16:r=4:d=2",
  "-f", "lavfi", "-i", "color=c=blue:s=16x16:r=4:d=2"];

for (const transition of ["", "transition=fade:", "transition=wipeleft:", "wipeleft:", "transition=unsupported:", "transition=slideright:"]) {
  it(`xfade ${transition || "default fade"} preserves the requested effect`, async (t) => {
    const volume = Volume.fromJSON({ "/out_1.png": "existing output" });
    const filter = `[0:v][1:v]xfade=${transition}duration=1:offset=1`;
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", ...inputs, "-filter_complex", filter, "/out_%d.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    if (transition.includes("unsupported") || transition.includes("slideright")) {
      assert.equal(result.exitCode, 1);
      assert.ok(Buffer.concat(errors).toString().includes("Unsupported xfade transition"));
      assert.equal(volume.readFileSync("/out_1.png", "utf8"), "existing output");
      assert.equal(volume.existsSync("/out_2.png"), false);
      return;
    }
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal(volume.readdirSync("/").length, 12);
    const frames = Array.from({ length: 12 }, (_, i) => decodeImage(volume.readFileSync(`/out_${i + 1}.png`) as Buffer));
    for (let i = 0; i < frames.length; i++) {
      const progress = Math.max(0, Math.min(1, (i - 4) / 4));
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const alpha = transition.includes("wipeleft") ? (i >= 8 || x > 16 * (1 - progress) ? 1 : 0) : progress;
          assert.deepEqual(Array.from(frames[i]!.data.slice((y * 16 + x) * 4, (y * 16 + x + 1) * 4)),
            [Math.round(253 * (1 - alpha)), 0, Math.round(254 * alpha), 255], `frame ${i + 1}, pixel ${x},${y}`);
        }
      }
    }
    await t.test("decoded pixels match native FFmpeg", { skip: !nativeAvailable }, () => {
      const native = spawnSync("ffmpeg", ["-v", "error", ...inputs, "-filter_complex", filter,
        "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"]);
      assert.equal(native.status, 0, native.stderr.toString());
      const actual = Buffer.concat(frames.map((frame) => frame.data));
      assert.equal(actual.length, native.stdout.length);
      for (let i = 0; i < actual.length; i++) {
        // Native blends YUV samples; the portable filter blends converted RGB.
        assert.ok(Math.abs(actual[i]! - native.stdout[i]!) <= 2, `byte ${i}: ${actual[i]} vs ${native.stdout[i]}`);
      }
    });
  });
}

for (const [size, rate, error] of [
  ["8x16", 4, "size"],
  ["16x8", 4, "size"],
  ["8x8", 4, "size"],
  ["16x16", 2, "timebase"]
] as const) {
  for (const existing of [false, true]) {
    it(`xfade rejects ${size} at ${rate} fps with ${existing ? "existing" : "new"} output`, async () => {
      const volume = Volume.fromJSON(existing ? { "/out_1.png": "existing output" } : {});
      const before = volume.toJSON();
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", ...inputs.slice(0, 4),
          "-f", "lavfi", "-i", `color=c=blue:s=${size}:r=${rate}:d=2`,
          "-filter_complex", "[0:v][1:v]xfade=transition=fade:duration=1:offset=1", "/out_%d.png"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.notEqual(result.exitCode, 0);
      const stderr = Buffer.concat(errors).toString();
      assert.ok(stderr.includes("xfade") && stderr.includes(error), stderr);
      assert.deepEqual(volume.toJSON(), before);
    });
  }
}

for (const offset of ["", ":offset=0"]) {
  it(`xfade duration=1${offset} starts blending at zero`, async () => {
    const volume = Volume.fromJSON({});
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error",
        "-f", "lavfi", "-i", "color=c=red:s=8x8:r=4:d=2",
        "-f", "lavfi", "-i", "color=c=blue:s=8x8:r=4:d=2",
        "-filter_complex", `[0:v][1:v]xfade=duration=1${offset}`, "/%d.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal(volume.readdirSync("/").length, 8);
    // Native FFmpeg PNG red channels; allow one unit for lavfi color conversion.
    for (const [index, red] of [254, 190, 127, 63, 0, 0, 0, 0].entries()) {
      const frame = decodeImage(volume.readFileSync(`/${index + 1}.png`) as Buffer);
      assert.ok(Math.abs(frame.data[0]! - red) <= 1,
        `frame ${index + 1}: expected red ${red}, got ${frame.data[0]}`);
    }
  });
}
