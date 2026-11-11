import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

// Complete rawvideo output from native FFmpeg 7.0.2, including the partial final sheet.
for (const [filter, format, length, hash] of [
  ["tile=2x1:color=red", "rgb24", 96, "6768088ed0dafd8a1c169e172722b8105d7f9725965cd92364135104c539afd8"],
  ["tile=2x1:margin=1:color=red", "rgb24", 288, "7c14d2b80b9f5d10eb991904d3d6a5348e62d3c304708b62779897e3293cce4d"],
  ["tile=2x1:color=red", "gray", 32, "91293ff0e6900ef36889c3e0c3c4b34d33a389b046b433fed8a11ca98f2c8f2f"],
  ["format=rgb24,tile=2x1:color=red", "rgb24", 96, "abd5a5de01a1b5bc15d39b38195877e264ed6574c4a1068a39b8f2f31f63f8c4"],
  ["tile=2x1:padding=1:init_padding=1:overlap=1:color=red", "rgb24", 210, "0709ba2726167ff404f1d8e5af6df4e165b6bc465e5835c2e42e72a581d73099"],
  ["format=rgb24,tile=2x1:margin=1:color=red", "rgb24", 288, "896a3418dc7c11e3926955d4e71ccff407c8ab5938d988a2cbfb2e29a700c095"]
] as const) {
  it(`fills in the negotiated format for ${filter} with ${format} output`, async () => {
    const input = Buffer.from(Array.from({ length: 7 }, (_, i) =>
      [16 * (i + 1), 16 * (i + 1) + 1, 16 * (i + 1), 16 * (i + 1) + 1]).flat());
    const volume = Volume.fromJSON({ "/in.gray": input });
    const argumentValues = createCommandArguments([
      "-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x2",
      "-framerate", "6", "-i", "/in.gray", "-vf", filter, "-fps_mode", "passthrough",
      "-pix_fmt", format, "-f", "rawvideo", "pipe:1"
    ]);
    const output: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      command: "ffmpeg", args: argumentValues.args, argumentValues,
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const bytes = Buffer.concat(output);
    assert.equal(bytes.length, length);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
    assert.deepEqual(volume.readFileSync("/in.gray"), input);
  });
}
