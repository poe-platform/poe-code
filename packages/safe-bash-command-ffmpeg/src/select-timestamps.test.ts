import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 reference outputs for seven 2x2 YUV444 frames at 5 fps.
for (const [filter, length, hash] of [
  ["select=gt(pts\\,2)", 48, "32646085117cc12ac585a9b516549adda55fa34e876246048fcca6aae09f09a1"],
  ["select=eq(pts-start_pts\\,2)", 12, "800edfea8432478a44906f59283ae071730dc6320848b7674444ac2027d312ea"],
  ["select=eq(TB\\,0.2)", 84, "a30dcc48f6f88e4e735fa8fcf8906d92f28bb60081a61a0a2c8a1e0b098b514d"],
  ["select=gt(t\\,0.4)", 48, "32646085117cc12ac585a9b516549adda55fa34e876246048fcca6aae09f09a1"],
  ["select=eq(n\\,2)", 12, "800edfea8432478a44906f59283ae071730dc6320848b7674444ac2027d312ea"],
  ["select=gte(n\\,0)", 84, "a30dcc48f6f88e4e735fa8fcf8906d92f28bb60081a61a0a2c8a1e0b098b514d"],
  ["setpts=PTS+10,select=eq(pts\\,12)*eq(start_pts\\,10)", 12, "800edfea8432478a44906f59283ae071730dc6320848b7674444ac2027d312ea"],
  ["trim=start_frame=2,select=eq(pts\\,start_pts)", 12, "800edfea8432478a44906f59283ae071730dc6320848b7674444ac2027d312ea"],
  ["fps=10,select=eq(pts\\,4)*eq(TB\\,0.1)", 12, "800edfea8432478a44906f59283ae071730dc6320848b7674444ac2027d312ea"]
] as const) {
  it(`select uses incoming timestamp ticks for ${filter}`, async () => {
    const input = Buffer.concat([
      Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
      ...[16, 235, 16, 235, 235, 16, 235].flatMap(y => [
        Buffer.from("FRAME\n"), Buffer.alloc(4, y), Buffer.alloc(8, 128)
      ])
    ]);
    const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
    const argumentValues = createCommandArguments([
      "-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"
    ]);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      command: "ffmpeg", args: argumentValues.args, argumentValues,
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = volume.readFileSync("/out.raw") as Buffer;
    assert.equal(output.length, length);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    assert.deepEqual(volume.readFileSync("/in.y4m"), input);
  });
}
