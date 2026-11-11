import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

for (const [level, prefix, expectedPts] of [
  ["debug", "", [0, 1, 2]],
  ["48", "", [0, 1, 2]],
  ["trace", "", [0, 1, 2]],
  ["debug", "setpts=PTS+4,settb=1/8,", [8, 10, 12]],
  ["verbose", "", []],
  ["info", "", []],
  ["warning", "", []],
  ["quiet", "", []]
] as const) {
  it(`mpdecimate logs input decisions at ${level} with ${prefix || "original timestamps"}`, async () => {
    const frames = [40, 40, 100].map(luma => Buffer.concat([
      Buffer.alloc(256, luma), Buffer.alloc(128, 128)
    ]));
    const input = Buffer.concat(frames);
    const volume = Volume.fromJSON({ "/in.raw": input });
    const argumentValues = createCommandArguments([
      "-hide_banner", "-nostats", "-v", level, "-f", "rawvideo", "-pixel_format", "yuv420p",
      "-video_size", "16x16", "-framerate", "4", "-i", "/in.raw", "-vf", `${prefix}mpdecimate,showinfo`,
      "-fps_mode", "passthrough", "-pix_fmt", "yuv420p", "-f", "rawvideo", "pipe:1"
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
    assert.deepEqual(Buffer.concat(output), Buffer.concat([frames[0]!, frames[2]!]));
    const decisions = stderr.split("\n").filter(line => line.includes("[mpdecimate]")).map(line => {
      const message = line.slice(line.indexOf("] ") + 2);
      return message.split(" ").slice(0, 2).join(" ");
    });
    assert.deepEqual(decisions, expectedPts.map((pts, index) => `${index === 1 ? "drop" : "keep"} pts:${pts}`));
    const showinfoPts = stderr.split("\n").filter(line => line.includes("[showinfo] n:"))
      .map(line => Number(line.split(" pts:")[1]!.split(" ")[0]));
    assert.deepEqual(showinfoPts, ["quiet", "warning"].includes(level) ? [] : prefix ? [8, 12] : [0, 2]);
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
  });
}
