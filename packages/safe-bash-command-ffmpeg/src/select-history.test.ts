import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const frames = [16, 235, 16, 235, 235, 16, 235].map(y =>
  Buffer.from([y, y, y, y, 128, 128, 128, 128, 128, 128, 128, 128]));
const input = Buffer.concat([
  Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
  ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])
]);
// SHA-256 values from native FFmpeg 7.0.2 on this fixture.
const firstHash = "800edfea8432478a44906f59283ae071730dc6320848b7674444ac2027d312ea";
const spacedHash = "9488c7755ffa4589f2d5013ed24019e750b3013296e1361f0b39067a60d01235";

for (const complex of [false, true]) {
  for (const [filter, indices, hash] of [
    ["select=isnan(prev_pts)", [0], firstHash],
    ["select=isnan(prev_selected_pts)", [0], firstHash],
    ["select=isnan(prev_selected_pts)+gte(pts-prev_selected_pts\\,3)", [0, 3, 6], spacedHash],
    ["select=isnan(prev_t)", [0], firstHash],
    ["select=isnan(prev_selected_t)", [0], firstHash],
    ["select=not(mod(n\\,3))", [0, 3, 6], spacedHash],
    ["select='eq(prev_pts,1)'", [2]],
    ["select='eq(pts-prev_pts,1)'", [1, 2, 3, 4, 5, 6]],
    ["select='eq(n,1)+eq(prev_selected_pts,1)'", [1, 2]],
    ["setpts=PTS+7,select='eq(prev_pts,8)+eq(prev_selected_pts,9)'", [2, 3]],
    ["select='not(mod(n,2))',select='isnan(prev_pts)*isnan(prev_selected_pts)'", [0]],
    ["select='not(mod(n,2))',select='eq(pts-prev_pts,2)'", [2, 4, 6]],
    ["select='prev_selected_pts+unknown'", null],
    ["trim=end_frame=0,select='prev_pts+unknown'", null]
  ] as const) {
    it(`select tracks tick timestamps: ${filter} (${complex ? "complex" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/bw.y4m": input, "/out.raw": "KEEP" });
      const before = volume.toJSON();
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/bw.y4m",
          ...(complex ? ["-filter_complex", `[0:v]${filter}[o]`, "-map", "[o]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (indices === null) {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("select:"), stderr);
        assert.deepEqual(volume.toJSON(), before);
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, indices.length * 12);
        assert.deepEqual(output, Buffer.concat(indices.map(index => frames[index]!)));
        if (hash) assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      }
    });
  }
}
