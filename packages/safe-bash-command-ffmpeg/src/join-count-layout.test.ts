import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [options, expected] of [
  ["channel_layout=2C", "01004701fdfffdff47010100"],
  ["channel_layout=2 channels", "01004701fdfffdff47010100"],
  ["channel_layout=1C", "0100fdff4701"],
  ["channel_layout=1 channels", "0100fdff4701"],
  ["channel_layout=2C:map=1.0-FL", undefined],
  ["channel_layout=2 channels:map=1.0-FL", undefined],
  ["channel_layout=stereo:map=1.0-FL", "47010100fdfffdff01004701"],
  ["channel_layout=stereo", "01004701fdfffdff47010100"],
  ["channel_layout=3C", undefined],
  ["channel_layout=2147483647C", undefined]
] as const) {
  it(`routes count-only join output layouts: ${options}`, async () => {
    const volume = Volume.fromJSON({
      "/0.pcm": Buffer.from("0100fdff4701", "hex"),
      "/1.pcm": Buffer.from("4701fdff0100", "hex")
    });
    const output: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", ...[0, 1].flatMap(index =>
        ["-f", "s16le", "-ar", "8000", "-ac", "1", "-i", `/${index}.pcm`]),
      "-filter_complex", `[0:a][1:a]join=${options}[out]`, "-map", "[out]", "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (expected === undefined) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(stderr.includes("join"), stderr);
      assert.equal(Buffer.concat(output).length, 0);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(output).toString("hex"), expected);
    }
  });
}
