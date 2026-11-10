import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseY4m } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const gray of [true, false]) {
  for (const [filter, rate, count] of [
    ["telecine", "15:2", 7],
    ["telecine=pattern=23", "15:2", 7],
    ["telecine=pattern=22", "6:1", 6]
  ] as const) {
    it(`writes ${rate} for ${gray ? "gray" : "color"} input for ${filter}`, async () => {
      const frames = Array.from({ length: 6 }, (_, frame) => Buffer.from(
        Array.from({ length: 3 }, (_, plane) => Array.from({ length: 4 }, (_, row) =>
          Array<number>(4).fill(plane === 0 ? 32 + 24 * frame + 3 * row : gray ? 128
            : plane === 1 ? 35 + 9 * frame + row : 216 - 8 * frame - row))).flat(2)));
      const volume = Volume.fromJSON({
        "/in.y4m": Buffer.concat([Buffer.from("YUV4MPEG2 W4 H4 F6:1 Ip A1:1 C444\n"),
          ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]),
        "/out.y4m": "KEEP"
      });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
          "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "yuv4mpegpipe", "/out.y4m"],
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
      const output = volume.readFileSync("/out.y4m") as Buffer;
      const header = output.subarray(0, output.indexOf(10)).toString().split(" ");
      assert.ok(header.includes(`F${rate}`), header.join(" "));
      const decoded = parseY4m(output).tracks[0]!.decodedVideoFrames!;
      assert.equal(decoded.length, count);
      assert.equal(decoded[0]!.durationSeconds, count === 7 ? 2 / 15 : 1 / 6);
    });
  }
}
