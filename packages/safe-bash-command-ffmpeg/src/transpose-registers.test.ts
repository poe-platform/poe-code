import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// One 4x2 grayscale frame; expected bytes from native FFmpeg 7.0.2.
for (const [filter, expected] of [
  ["transpose=dir='st(0,1);ld(0)'", "1410151116121713"],
  ["transpose=dir='st(0,2);ld(0)+1'", "1713161215111410"],
  ["transpose=dir=1+1", "1317121611151014"],
  ["transpose=dir='st(0,ld(0)+1);ld(0)'", "1410151116121713"],
  ["transpose=dir='st(0,1);ld(0)',transpose=dir='ld(0)+2'", "1011121314151617"]
] as const) {
  it(`${filter} matches native status and bytes with independent registers`, async () => {
    const input = Buffer.from([16, 17, 18, 19, 20, 21, 22, 23]);
    const volume = Volume.fromJSON({ "/in.raw": input });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "4x2",
        "-i", "/in.raw", "-vf", filter, "-pix_fmt", "gray", "-f", "rawvideo", "/out.raw"],
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
