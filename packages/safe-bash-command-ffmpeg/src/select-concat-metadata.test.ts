import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 60 }, (_, i) => i));
const start = "metadata=mode=add:key=lavf.concatdec.start_time:value=400000";
const duration = "metadata=mode=add:key=lavf.concatdec.duration:value=400000";
const segment = `${start},${duration}`;

for (const [filter, indices] of [
  [`${segment},select=concatdec_select`, [2, 3]],
  [`${segment},select=1`, [0, 1, 2, 3, 4]],
  ["select=isnan(concatdec_select)", [0, 1, 2, 3, 4]],
  ["select=not(isnan(concatdec_select))", []],
  [`${start},select=concatdec_select`, [2, 3, 4]],
  [`${duration},select=isnan(concatdec_select)`, [0, 1, 2, 3, 4]],
  [`${segment},metadata=delete:key=lavf.concatdec.start_time,select=isnan(concatdec_select)`, [0, 1, 2, 3, 4]],
  [`${segment},select=eq(concatdec_select\\,0)`, [0, 1, 4]],
  [`${segment},select=lt(concatdec_select\\,0)`, [2, 3]]
] as const) {
  it(`video concat segment selection: ${filter}`, async () => {
    const volume = Volume.fromJSON({ "/in.rgb": input });
    let stdout = "";
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "2x2",
        "-framerate", "5", "-i", "/in.rgb", "-vf", filter, "-fps_mode", "passthrough",
        "-c:v", "rawvideo", "-pix_fmt", "rgb24", "-f", "framecrc", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const rows = stdout.split("\n").filter(line => line && !line.startsWith("#"))
      .map(line => line.split(",").map(column => column.trim()));
    assert.deepEqual(rows.map(row => Number(row[2])), indices);
    for (const [n, index] of indices.entries()) {
      const frame = input.subarray(index * 12, (index + 1) * 12);
      let a = 0;
      let b = 0;
      for (const byte of frame) { a += byte; b += a; }
      assert.equal(Number(rows[n]![4]), frame.length);
      assert.equal(Number(rows[n]![5]), b * 65536 + a);
    }
  });
}
