import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 reference outputs for seven 2x2 YUV444 frames at 5 fps.
for (const [filter, length, hash] of [
  ["tile=3x1:overlap=1,select=gte(t\\,0.6)", 72, "0613fd1caad588bc5f1f8ee7aa571f2a55b2a3b5ac54a41bb027902c42f12783"],
  ["tile=3x1:overlap=1,select=lt(t\\,0.5)", 36, "cd59be4aa45337203f1b564ae58f5a9cbbbfd636daaa76e195925ea4fc4c331c"],
  ["tile=3x1:overlap=1,fps=5", 252, "c9c5fa9c0ae5e75f9ac177aa2578f1dfa2a67478197d07f18cc075865f309041"],
  ["tile=3x1:overlap=1", 108, "872eb48cb8863744818b2157a899264e90220b023bf380a07b1ac8ffe6fdb2ba"],
  ["tile=3x1:overlap=1,select=eq(n\\,1)", 36, "0cf1bf73f844b12a4dc02fc02b5f3d6d964bb145aad7b409ac5b739c6c9c6a96"],
  ["tile=3x1,select=gte(t\\,0.6)", 72, "6150637f8da3b1161f1f34a6e5b13cfff53d83ac2cacfe85e2ab744e91cbebfc"]
] as const) {
  it(`matches native tile timing and pixels for ${filter}`, async () => {
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
