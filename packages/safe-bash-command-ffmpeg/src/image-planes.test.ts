import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const { extra, maxOutputBytes } of [
  { extra: [] }, { extra: ["-start_number", "7", "-frames:v", "1"] },
  { extra: ["-atomic_writing", "1"] }, { extra: [], maxOutputBytes: 23 }, { extra: [], maxOutputBytes: 47 }
]) {
  it(`writes native image2 Y/U/V planes (${extra.join(" ")}, limit=${maxOutputBytes})`, async () => {
    const volume = new Volume();
    for (const [index, rgb] of [[255, 0, 0], [0, 0, 255]].entries()) {
      const bytes = encodeImage({ width: 4, height: 4, channels: 4,
        data: new Uint8Array(Array.from({ length: 16 }, () => [...rgb, 255]).flat()),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: false
      }, { format: "png" }).data;
      volume.writeFileSync(`/in${index + 1}.png`, bytes);
    }
    let stderr = "";
    const result = await createFfmpegCommand(maxOutputBytes === undefined ? {} : { limits: { maxOutputBytes } }).execute({
      args: ["-y", "-v", "error", "-i", "/in%d.png", "-pix_fmt", "yuv420p", "-c:v", "rawvideo", "-f", "image2", ...extra, "/plane%02d.Y"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); },
        async rename(from: string, to: string) { volume.renameSync(from, to); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (maxOutputBytes !== undefined) {
      assert.notEqual(result.exitCode, 0);
      assert.match(stderr, /output.*limit|limit.*output/i);
      assert.equal(volume.readdirSync("/").length, maxOutputBytes < 24 ? 2 : 5);
      return;
    }
    assert.equal(result.exitCode, 0, stderr);
    const limited = extra.some(option => option === "-frames:v");
    const expected = [[0x51, 0x5a, 0xf0], [0x29, 0xf0, 0x6e]].slice(0, limited ? 1 : 2);
    for (const [frame, values] of expected.entries()) {
      for (const [plane, suffix] of ["Y", "U", "V"].entries()) {
        assert.deepEqual(volume.readFileSync(`/plane${String(frame + (limited ? 7 : 1)).padStart(2, "0")}.${suffix}`),
          Buffer.alloc(plane === 0 ? 16 : 4, values[plane]));
      }
    }
    assert.equal(volume.readdirSync("/").length, 2 + expected.length * 3);
  });
}
