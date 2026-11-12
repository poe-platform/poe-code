import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const [rate, timeBase] of [["25", "1/25"], ["4", "1/4"], ["3/2", "2/3"], ["30000/1001", "1001/30000"]]) {
  it(`preserves the image2 packet clock in framecrc at ${rate} fps`, async () => {
    const volume = Volume.fromJSON({});
    const packets = [1, 2, 4, 5, 8].map(index => {
      const bytes = encodeImage({
        width: 2, height: 2, channels: 3,
        data: Uint8Array.from(Array.from({ length: 4 }, () => [20 * index, 0, 0]).flat()),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: false
      }, { format: "png" }).data;
      const path = `/f-0${index}.png`;
      volume.writeFileSync(path, bytes);
      const date = new Date(1700000000000 + 1250 * index);
      volume.utimesSync(path, date, date);
      let a = 0, b = 0;
      for (const byte of bytes) { a = (a + byte) % 65521; b = (b + a) % 65521; }
      return [String(bytes.length), `0x${((b * 65536 + a) >>> 0).toString(16).padStart(8, "0")}`];
    });
    let stdout = "", stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "image2", "-framerate", rate!, "-i", "/f-%02d.png", "-c:v", "copy", "-f", "framecrc", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.ok(stdout.includes(`#tb 0: ${timeBase}\n`), stdout);
    assert.deepEqual(stdout.trim().split("\n").filter(line => !line.startsWith("#"))
      .map(line => line.split(",").map(field => field.trim())),
    packets.slice(0, 2).map((packet, index) => ["0", String(index), String(index), "1", ...packet]));
  });
}
