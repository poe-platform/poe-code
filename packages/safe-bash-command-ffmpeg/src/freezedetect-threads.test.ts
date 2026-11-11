import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const [option, valid] of [
    ["", true], [":threads=1", true], [":threads=0", true], [":threads=2", true],
    [":threads=2147483647", true], [":threads=default", true], [":threads=min", true],
    [":threads=max", true], [":threads=1+1", true], [":threads=0.5", true],
    [":threads=1:threads=2", true],
    [":threads=-1", false], [":threads=2147483648", false], [":threads=", false],
    [":threads=bogus", false], [":threads=NaN", false], [":threads=Infinity", false],
    [":threads=-1:threads=1", false], [":threads=1:unknown=1", false]
  ] as const) {
    it(`validates freezedetect ${option || "default threads"} and preserves bytes and events (graph=${graph})`, async () => {
      // Native FFmpeg 7.0.2: scheduling does not affect frames or freeze events.
      const input = Buffer.from("1414141414141414141414181414141814141418fa000018", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const filter = `freezedetect=n=0:d=0.5${option}`;
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-y", "-f", "rawvideo", "-pixel_format", "rgba",
          "-video_size", "1x1", "-framerate", "4", "-i", "in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", valid ? "pipe:1" : "out.raw"],
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
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
      assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      if (!valid) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(Buffer.concat(output).length, 0);
        assert.ok(error.includes("freezedetect"), error);
        assert.ok(!error.includes("freeze_start:"), error);
        return;
      }
      assert.equal(result.exitCode, 0, error);
      assert.deepEqual(Buffer.concat(output), input);
      assert.deepEqual(error.trim().split("\n"), [
        "lavfi.freezedetect.freeze_start: 0",
        "lavfi.freezedetect.freeze_duration: 0.5",
        "lavfi.freezedetect.freeze_end: 0.5",
        "lavfi.freezedetect.freeze_start: 0.5",
        "lavfi.freezedetect.freeze_duration: 0.75",
        "lavfi.freezedetect.freeze_end: 1.25"
      ]);
    });
  }
}
