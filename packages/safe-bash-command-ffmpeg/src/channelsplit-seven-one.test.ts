import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// PCM16 reference bytes from native FFmpeg 7.0.2.
for (const [layout, channels, expectedChannels] of [
  ["mono", 1, ["00000000", "00000000", "e80319fc", "00000000", "00000000", "00000000", "00000000", "00000000"]],
  ["stereo", 2, ["e80319fc", "d00731f8", "00000000", "00000000", "00000000", "00000000", "00000000", "00000000"]],
  ["3.0", 3, ["e80319fc", "d00731f8", "b80b49f4", "00000000", "00000000", "00000000", "00000000", "00000000"]],
  ["3.0(back)", 3, ["e80319fc", "d00731f8", "00000000", "00000000", "4908b7f7", "4908b7f7", "00000000", "00000000"]],
  ["4.0", 4, ["e80319fc", "d00731f8", "b80b49f4", "00000000", "0c0bf4f4", "0c0bf4f4", "00000000", "00000000"]],
  ["quad", 4, ["e80319fc", "d00731f8", "00000000", "00000000", "b80b49f4", "a00f61f0", "00000000", "00000000"]],
  ["5.0", 5, ["e80319fc", "d00731f8", "b80b49f4", "00000000", "a00f61f0", "881379ec", "00000000", "00000000"]],
  ["5.1", 6, ["e80319fc", "d00731f8", "b80b49f4", "a00f61f0", "881379ec", "701791e8", "00000000", "00000000"]],
  ["5.1(side)", 6, ["e80319fc", "d00731f8", "b80b49f4", "a00f61f0", "00000000", "00000000", "881379ec", "701791e8"]],
  ["6.1", 7, ["e80319fc", "d00731f8", "b80b49f4", "a00f61f0", "cf0d31f2", "cf0d31f2", "701791e8", "581ba9e4"]],
  ["hexagonal", 6, ["4a02b7fd", "94046dfb", "dd0623f9", "00000000", "dc1225ed", "2615dbea", "00000000", "00000000"]],
  ["octagonal", 8, ["4a02b7fd", "94046dfb", "dd0623f9", "00000000", "dc1225ed", "2615dbea", "0410fcef", "4e12b2ed"]],
  ["7.1(wide)", 8, ["a00f61f0", "881379ec", "dc0525fa", "d00731f8", "c4093df6", "b80b49f4", "00000000", "00000000"]],
  ["2.1", 3, ["e80319fc", "d00731f8", "00000000", "b80b49f4", "00000000", "00000000", "00000000", "00000000"]],
  ["7.1", 8, ["e80319fc", "d00731f8", "b80b49f4", "a00f61f0", "881379ec", "701791e8", "581ba9e4", "401fc1e0"]]
] as const) {
  for (const [index, speaker] of ["FL", "FR", "FC", "LFE", "BL", "BR", "SL", "SR"].entries()) {
    const expected = expectedChannels[index];
    for (const graph of [false, true]) {
      for (const autoConvert of layout === "mono" ? [true, false] : [true]) {
        it(`negotiates ${layout} to 7.1 ${speaker} (${graph ? "graph" : "simple"}, auto conversion ${autoConvert})`, async () => {
          const input = Buffer.alloc(channels * 4);
          for (let channel = 0; channel < channels; channel++) {
            input.writeInt16LE(1000 * (channel + 1), channel * 2);
            input.writeInt16LE(1 - 1000 * (channel + 1), (channels + channel) * 2);
          }
          const volume = Volume.fromJSON({});
          const stdout: Buffer[] = [];
          let stderr = "";
          const filter = `channelsplit=channel_layout=7.1:channels=${speaker}`;
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
