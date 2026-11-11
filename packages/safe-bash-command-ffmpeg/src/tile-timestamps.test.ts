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

// Native FFmpeg 7.0.2 reports a full encoder tick for the final partial sheet.
for (const [layout, timeBase, width, checksums] of [
  ["2x2", "1/1", 4, ["0x04c00194", "0x08d1012d"]],
  ["2x1", "1/2", 4, ["0x00a40052", "0x02d40142", "0x041d012d"]]
] as const) {
  it(`preserves partial tile=${layout} framecrc duration, timestamps and pixels`, async () => {
    const input = Buffer.from([10, 11, 30, 31, 60, 61, 100, 101, 150, 151]);
    const volume = Volume.fromJSON({ "/in.gray": input });
    let stdout = "", stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x1",
        "-framerate", "4", "-i", "/in.gray", "-vf", `tile=${layout}`, "-fps_mode", "passthrough",
        "-pix_fmt", "gray", "-bitexact", "-f", "framecrc", "pipe:1"],
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
    assert.equal(stderr, "");
    const height = layout === "2x2" ? 2 : 1;
    assert.equal(stdout, [
      `#tb 0: ${timeBase}`, "#media_type 0: video", "#codec_id 0: rawvideo",
      `#dimensions 0: ${width}x${height}`, "#sar 0: 0/1",
      ...checksums.map((checksum, index) =>
        `0, ${String(index).padStart(10)}, ${String(index).padStart(10)},        1, ${String(width * height).padStart(8)}, ${checksum}`),
      ""
    ].join("\n"));
    assert.deepEqual(volume.readFileSync("/in.gray"), input);
  });
}
