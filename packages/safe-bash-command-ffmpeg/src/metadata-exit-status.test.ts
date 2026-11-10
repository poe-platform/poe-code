import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

// Linux FFmpeg 7.0.2 statuses and bytes for the eight-frame YUV444 fixture.
for (const [filter, exitCode] of [
  ["metadata=mode=unknown", 234],
  ["metadata=print:oops=1", 8],
  ["metadata=print:key=lavfi.demo", 0]
] as const) {
  for (const existing of [false, true]) {
    it(`${filter} returns ${exitCode} with ${existing ? "existing" : "absent"} output`, async () => {
      const luma = [[16, 16, 16, 16], [16, 16, 16, 32], [16, 16, 16, 16],
        [200, 200, 200, 200], [200, 200, 200, 200], [200, 200, 200, 200],
        [80, 80, 80, 80], [16, 16, 16, 16]];
      const frames = luma.map(values => Buffer.from([...values, ...Array<number>(8).fill(128)]));
      const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
        ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]);
      const volume = Volume.fromJSON({ "/in.y4m": input, "/stats.log": "KEEP",
        ...(existing ? { "/o.raw": "KEEP" } : {}) });
      const before = volume.toJSON();
      const errors: Uint8Array[] = [];
      const argumentValues = createCommandArguments([
        "-hide_banner", "-nostats", "-v", "info", "-y", "-i", "in.y4m", "-vf", filter,
        "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "o.raw"
      ]);
      const result = await createFfmpegCommand().execute({
        command: "ffmpeg", args: argumentValues.args, argumentValues,
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      const stderr = Buffer.concat(errors).toString();
      if (exitCode !== 0) {
        assert.deepEqual(volume.toJSON(), before);
        assert.ok(stderr.includes("metadata:"), stderr);
      } else {
        assert.deepEqual(volume.readFileSync("/in.y4m"), input);
        assert.equal(volume.readFileSync("/stats.log", "utf8"), "KEEP");
        const output = volume.readFileSync("/o.raw") as Buffer;
        assert.deepEqual(output, Buffer.concat(frames));
        assert.equal(output.length, 96);
        assert.equal(createHash("sha256").update(output).digest("hex"),
          "4d240453b9d26c288a7fb339c50f2c0385b0484486434ef7365e15258e7a1278");
        assert.equal(stderr, "");
      }
      assert.equal(result.exitCode, exitCode, stderr);
    });
  }
}
