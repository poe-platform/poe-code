import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: FL, FR, FC, LFE, BL, BR after negotiating back-surround 5.1.
for (const [layout, channels, expected] of [
  ["mono", 1, ["00000000", "00000000", "e80319fc", "00000000", "00000000", "00000000"]],
  ["3.0", 3, ["e80319fc", "d00731f8", "b80b49f4", "00000000", "00000000", "00000000"]],
  ["3.0(back)", 3, ["e80319fc", "d00731f8", "00000000", "00000000", "4908b7f7", "4908b7f7"]],
  ["4.0", 4, ["e80319fc", "d00731f8", "b80b49f4", "00000000", "0c0bf4f4", "0c0bf4f4"]],
  ["quad", 4, ["e80319fc", "d00731f8", "00000000", "00000000", "b80b49f4", "a00f61f0"]],
  ["5.0", 5, ["e80319fc", "d00731f8", "b80b49f4", "00000000", "a00f61f0", "881379ec"]],
  ["5.1(side)", 6, ["e80319fc", "d00731f8", "b80b49f4", "a00f61f0", "881379ec", "701791e8"]],
  ["7.1", 8, ["4a02b7fd", "94046dfb", "dd0623f9", "2709d9f6", "c4163de9", "ac1a55e5"]],
  ["6.1", 7, ["4a02b7fd", "94046dfb", "dd0623f9", "2709d9f6", "d2152fea", "1c18e5e7"]],
  ["hexagonal", 6, ["4a02b7fd", "94046dfb", "dd0623f9", "00000000", "dc1225ed", "2615dbea"]],
  ["octagonal", 8, ["9e0162fe", "3c03c4fc", "db0426fb", "00000000", "5915a8ea", "1c18e5e7"]],
  ["7.1(wide)", 8, ["a00f61f0", "881379ec", "dc0525fa", "d00731f8", "c4093df6", "b80b49f4"]],
  ["2.1", 3, ["e80319fc", "d00731f8", "00000000", "b80b49f4", "00000000", "00000000"]],
  ["5.1", 6, ["e80319fc", "d00731f8", "b80b49f4", "a00f61f0", "881379ec", "701791e8"]]
] as const) {
  for (const [index, speaker] of ["FL", "FR", "FC", "LFE", "BL", "BR"].entries()) {
    for (const [graph, disabled] of [[false, false], [true, false], [false, true], [true, true]]) {
      // The matching-layout control needs no speaker conversion.
      if (disabled && layout === "5.1") continue;
      it(`routes ${layout} into 5.1 before selecting ${speaker} (${graph ? "graph" : "simple"}, conversion ${disabled ? "disabled" : "enabled"})`, async () => {
        const input = Buffer.alloc(channels * 4);
        for (let channel = 0; channel < channels; channel++) {
          input.writeInt16LE(1000 * (channel + 1), channel * 2);
          input.writeInt16LE(1 - 1000 * (channel + 1), (channels + channel) * 2);
        }
        const volume = new Volume();
        const stdout: Buffer[] = [];
        let stderr = "";
        const filter = `channelsplit=channel_layout=5.1:channels=${speaker}`;
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", ...(disabled ? ["-noauto_conversion_filters"] : []), "-f", "s16le", "-ar", "8000", "-ac", String(channels),
            "-channel_layout", layout, "-i", "pipe:0", ...(graph
              ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
              : ["-af", filter]), "-f", "s16le", "pipe:1"],
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
        if (disabled) {
          assert.equal(result.exitCode, 234, stderr);
          assert.ok(stderr.includes("automatic conversion is disabled"), stderr);
          assert.equal(Buffer.concat(stdout).length, 0);
          return;
        }
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        assert.equal(Buffer.concat(stdout).toString("hex"), expected[index]);
      });
    }
  }
}
