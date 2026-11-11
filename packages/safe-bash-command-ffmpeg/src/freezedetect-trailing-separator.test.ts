import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const [options, valid] of [
    ["n=0:d=0.5", true],
    ["n=0:d=0.5:", true],
    ["noise=0:duration=0.5:", true],
    ["0:0.5:", true],
    ["n=0:d=0.5::", false],
    ["n=0::d=0.5", false],
    ["n=:d=0.5:", false],
    ["n=0:d=:", false],
    [":", false]
  ] as const) {
    it(`handles freezedetect separators in ${JSON.stringify(options)} (graph=${graph})`, async () => {
      const input = Buffer.from("1414141414141414141414181414141814141418fa000018", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input });
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const filter = `freezedetect=${options}`;
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "rawvideo", "-pixel_format", "rgba",
          "-video_size", "1x1", "-framerate", "4", "-i", "in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"],
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
