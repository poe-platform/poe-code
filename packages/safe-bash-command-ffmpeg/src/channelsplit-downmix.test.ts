import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 output for two interleaved, opposite-sign frames.
for (const [layout, channels, left, right] of [
  ["3.0", 3, "2407ddf8", "6e0993f6"],
  ["3.0(back)", 3, "83067ef9", "1d09e4f6"],
  ["4.0", 4, "1009f1f6", "d50a2cf5"],
  ["5.0", 5, "a10960f6", "640c9df3"],
  ["7.1", 8, "860e7bf1", "8c1175ee"],
  ["6.1", 7, "390dc8f2", "830f7ef0"],
  ["hexagonal", 6, "ff0b02f4", "490eb8f1"],
  ["octagonal", 8, "fe0e03f1", "991168ee"],
  ["7.1(wide)", 8, "a00f61f0", "b91248ed"],
  ["2.1", 3, "e80319fc", "d00731f8"],
  ["mono", 1, "c3023efd", "c3023efd"]
] as const) {
  for (const [speaker, expected] of [["FL", left], ["FR", right]]) {
    for (const graph of [false, true]) for (const conversion of [true, false]) {
      it(`downmixes ${layout} to stereo before selecting ${speaker} (${graph ? "graph" : "simple"}, conversion ${conversion ? "enabled" : "disabled"})`, async () => {
        const input = Buffer.alloc(channels * 4);
        for (let channel = 0; channel < channels; channel++) {
          input.writeInt16LE(1000 * (channel + 1), channel * 2);
          input.writeInt16LE(1 - 1000 * (channel + 1), (channels + channel) * 2);
        }
        const volume = new Volume();
        const stdout: Buffer[] = [];
        let stderr = "";
        const filter = `channelsplit=channel_layout=stereo:channels=${speaker}`;
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", ...(conversion ? [] : ["-noauto_conversion_filters"]), "-f", "s16le", "-ar", "8000", "-ac", String(channels),
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
        assert.equal(result.exitCode, conversion ? 0 : 234, stderr);
        if (conversion) assert.equal(stderr, "");
        else assert.ok(stderr.includes("common format"), stderr);
        assert.equal(Buffer.concat(stdout).toString("hex"), conversion ? expected : "");
      });
    }
  }
}
