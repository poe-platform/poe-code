import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const [filter, expected] of [
    [String.raw`tpad=start_duration='00\:00\:00.5'`, "000000000a0b1e1f3c3d"],
    [String.raw`tpad=stop_duration='00\:00\:00.5'`, "0a0b1e1f3c3d00000000"],
    [String.raw`tpad=start_duration=00\\:00\\:00.5`, "000000000a0b1e1f3c3d"],
    [String.raw`tpad=stop_duration=\'00:00:00.5\'`, "0a0b1e1f3c3d00000000"],
    [String.raw`tpad=start_duration='00\:00.5':stop_duration='00\:00.25'`, "000000000a0b1e1f3c3d0000"],
    [String.raw`tpad=start_duration='00\:00\:00.5':start_mode=clone`, "0a0b0a0b0a0b1e1f3c3d"],
    [String.raw`tpad=0:0:clone:clone:'00\:00\:00.5':'00\:00\:00.25'`, "0a0b0a0b0a0b1e1f3c3d3c3d"],
    [String.raw`tpad=start_duration='00\:00\:00.5':,null`, "000000000a0b1e1f3c3d"],
    ["tpad=start_duration=500ms", "000000000a0b1e1f3c3d"],
    ["tpad=stop_duration=500ms", "0a0b1e1f3c3d00000000"],
    [String.raw`tpad=start_duration='00\:60\:00'`, null],
    [String.raw`tpad=stop_duration='-00\:00\:00.5'`, null],
    [String.raw`tpad=start_duration='00\:00\:invalid'`, null]
  ] as const) {
    it(`${graph ? "graph" : "simple"} clock duration: ${filter}`, async () => {
      const input = Buffer.from("0a0b1e1f3c3d", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x1",
          "-framerate", "4", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (expected === null) {
        assert.notEqual(result.exitCode, 0, stderr);
        assert.ok(stderr.includes("invalid"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
