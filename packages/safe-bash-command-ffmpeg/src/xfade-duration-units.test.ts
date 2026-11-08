import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const options of ["duration=0.5:offset=1", "duration=500ms:offset=1",
  "duration=500000us:offset=1s", "duration=0.5s:offset=1000ms", "fade:500ms:1000000us"]) {
  const expected = [254, 254, 254, 254, 254, 127, 0, 0, 0, 0, 0, 0];
  it(`xfade ${options} preserves native transition timing`, async () => {
    const volume = Volume.fromJSON({});
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error",
        "-f", "lavfi", "-i", "color=c=red:s=8x8:r=4:d=2",
        "-f", "lavfi", "-i", "color=c=blue:s=8x8:r=4:d=2",
        "-filter_complex", `[0:v][1:v]xfade=${options}`, "/%d.png"],
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
    assert.equal(volume.readdirSync("/").length, expected.length);
    // Native FFmpeg PNG red channels; allow one unit for lavfi color conversion.
    for (const [index, red] of expected.entries()) {
      const frame = decodeImage(volume.readFileSync(`/${index + 1}.png`) as Buffer);
      assert.ok(Math.abs(frame.data[0]! - red) <= 1,
        `frame ${index + 1}: expected red ${red}, got ${frame.data[0]}`);
    }
  });
}
