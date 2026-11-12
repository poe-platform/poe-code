import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 RGBA output for the inline stereo PCM fixture.
for (const [colors, expected] of [
  ["red||blue", "00000000000000007f007ffe7f00007f7f00007f000000000000000000000000"],
  ["red|blue", "00000000000000007f007ffe7f00007f7f00007f000000000000000000000000"],
  ["||red|||blue||", "00000000000000007f007ffe7f00007f7f00007f000000000000000000000000"],
  ["red| |blue", "00000000000000007f007ffe7f00007f7f00007f000000000000000000000000"],
  ["red|", "0000000000000000fe0000fe7f00007f7f00007f000000000000000000000000"],
  ["red", "0000000000000000fe0000fe7f00007f7f00007f000000000000000000000000"],
  ["", "0000000000000000fefefefe7f7f7f7f7f7f7f7f000000000000000000000000"],
  ["|||", "0000000000000000fefefefe7f7f7f7f7f7f7f7f000000000000000000000000"],
  ["white", "0000000000000000fefefefe7f7f7f7f7f7f7f7f000000000000000000000000"]
] as const) {
  it(`matches native showwavespic with colors=${JSON.stringify(colors)}`, async () => {
    const input = Buffer.alloc(32);
    [32767, 0, -32768, 1000, 0, 7000, 1234, -20000, 400, 500, 32767, 0, -3000, 12000, 128, 128]
      .forEach((sample, index) => input.writeInt16LE(sample, index * 2));
    const volume = Volume.fromJSON({ "/in.raw": input });
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
        "-filter_complex", `showwavespic=s=2x4:colors=${colors}`, "-frames:v", "1",
        "-pix_fmt", "rgba", "-bitexact", "-f", "rawvideo", "-"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(Buffer.concat(stdout).toString("hex"), expected);
  });
}
