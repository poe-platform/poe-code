import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 output for one 4x2 gray frame containing samples 16..23.
for (const [direction, expected] of [
  ["min", "1014111512161317"],
  ["max", "1011121314151617"],
  ["default", "1014111512161317"],
  ["0", "1014111512161317"],
  ["7", "1011121314151617"]
] as const) {
  it(`transpose dir=${direction} matches native status and output bytes`, async () => {
    const input = Buffer.from([16, 17, 18, 19, 20, 21, 22, 23]);
    const volume = Volume.fromJSON({ "/in.raw": input });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "4x2",
        "-i", "/in.raw", "-vf", `transpose=dir=${direction}`, "-pix_fmt", "gray", "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
  });
}
