import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// PCM16 reference bytes from native FFmpeg 7.0.2.
for (const [layout, channels, left, right, center] of [
  ["mono", 1, "00000000", "00000000", "e80319fc"],
  ["stereo", 2, "e80319fc", "d00731f8", "00000000"],
  ["3.0(back)", 3, "83067ef9", "1d09e4f6", "00000000"],
  ["4.0", 4, "d00731f8", "6b0a96f5", "d00731f8"],
  ["quad", 4, "2407ddf8", "0c0bf5f4", "00000000"],
  ["5.0", 5, "c3083ef7", "ab0c56f3", "dd0623f9"],
  ["5.1", 6, "610aa0f5", "490eb8f1", "dd0623f9"],
  ["5.1(side)", 6, "610aa0f5", "490eb8f1", "dd0623f9"],
  ["7.1", 8, "590fa8f0", "4113c0ec", "db0426fb"],
  ["6.1", 7, "b40d4df2", "b91048ef", "4f05b1fa"],
  ["hexagonal", 6, "160cebf3", "1b0fe6f0", "4f05b1fa"],
  ["octagonal", 8, "ca0f37f0", "0613fbec", "0504fbfb"],
  ["7.1(wide)", 8, "a5105cef", "8d1474eb", "5404acfb"],
  ["2.1", 3, "e80319fc", "d00731f8", "00000000"],
  ["3.0", 3, "e80319fc", "d00731f8", "b80b49f4"]
] as const) {
  for (const [speaker, expected] of [["FL", left], ["FR", right], ["FC", center]]) {
    for (const graph of [false, true]) {
      for (const autoConvert of layout === "mono" ? [true, false] : [true]) {
        it(`negotiates ${layout} to 3.0 ${speaker} (${graph ? "graph" : "simple"}, auto conversion ${autoConvert})`, async () => {
          const input = Buffer.alloc(channels * 4);
          for (let channel = 0; channel < channels; channel++) {
            input.writeInt16LE(1000 * (channel + 1), channel * 2);
            input.writeInt16LE(1 - 1000 * (channel + 1), (channels + channel) * 2);
          }
          const volume = Volume.fromJSON({});
          const stdout: Buffer[] = [];
          let stderr = "";
          const filter = `channelsplit=channel_layout=3.0:channels=${speaker}`;
          const result = await createFfmpegCommand().execute({
            args: [...(autoConvert ? [] : ["-noauto_conversion_filters"]), "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", String(channels),
              "-channel_layout", layout, "-i", "pipe:0", ...(graph
                ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
              "-f", "s16le", "pipe:1"],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () { yield input; })(),
            stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          if (!autoConvert) {
            assert.notEqual(result.exitCode, 0);
            assert.equal(Buffer.concat(stdout).length, 0);
            return;
          }
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
          assert.equal(Buffer.concat(stdout).toString("hex"), expected);
        });
      }
    }
  }
}
