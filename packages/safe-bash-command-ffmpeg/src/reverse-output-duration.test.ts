import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [input, output, expected] of [
  [[], ["-t", "0.5"], [132, 112]],
  [[], ["-to", "0.5"], [132, 112]],
  [["-t", "0.5"], ["-t", "0.25"], [52]],
  [[], ["-frames:v", "2", "-t", "0.75"], [132, 112]],
  [["-t", "0.5"], [], [52, 32]],
  [[], [], [132, 112, 92, 72, 52, 32]],
  [[], ["-frames:v", "2"], [132, 112]],
] as const) {
  it(`reverse applies input ${input.join(" ")} before filtering and output ${output.join(" ")} after`, async () => {
    const volume = new Volume();
    volume.writeFileSync("/in.y4m", Buffer.concat([
      Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
      ...Array.from({ length: 6 }, (_, index) => Buffer.concat([
        Buffer.from("FRAME\n"), Buffer.alloc(4, 32 + 20 * index), Buffer.alloc(8, 128)
      ]))
    ]));
    volume.writeFileSync("/o.raw", "KEEP");
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", ...input, "-i", "/in.y4m", "-vf", "reverse", ...output,
        "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/o.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(volume.readFileSync("/o.raw"), Buffer.concat(expected.map(luma =>
      Buffer.concat([Buffer.alloc(4, luma), Buffer.alloc(8, 128)]))));
  });
}
