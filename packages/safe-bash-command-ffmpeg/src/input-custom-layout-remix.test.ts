import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [101, -901, 202, -802, 303, -703, 404, -604];
const mono = [-400, -300, -200, -100];

// Native FFmpeg 7.0.2 rejects these custom layouts during automatic conversion,
// while passthrough and explicit channel selection preserve the input samples.
for (const layout of ["FR+FL", "FL@Left+FR@Right", "stereo", "FL+FR"]) {
  for (const graph of [false, true]) {
    for (const [filter, options, expected, rejectNamed] of [
      ["", ["-ac", "1"], mono, true],
      ["", ["-ac", "2"], samples, false],
      ["aformat=channel_layouts=stereo", [], samples, false],
      ["aresample=ochl=stereo", [], samples, false],
      ["aformat=channel_layouts=mono", [], mono, true],
      ["aresample=ochl=mono", [], mono, true],
      ["aformat=channel_layouts=stereo", ["-ac", "1"], mono, true],
      ["aresample=ochl=stereo", ["-ac", "1"], mono, false],
      ["", [], samples, false],
      ["channelmap=1:mono", [], [-901, -802, -703, -604], false],
      ["channelmap=0|1:stereo", ["-ac", "1"], mono, false]
    ] as const) {
      it(`handles ${layout}, ${filter || "passthrough"} ${options.join(" ")} (graph=${graph})`, async () => {
        const input = Buffer.alloc(samples.length * 2);
        samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
        const volume = Volume.fromJSON({ "/in.raw": input });
        const stdout: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ch_layout", layout, "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter || "anull"}[out]`, "-map", "[out]"]
              : filter ? ["-af", filter] : []),
            ...options, "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        const rejected = (layout === "FR+FL" || layout.includes("@") && rejectNamed) &&
          (options.length > 0 || filter !== "") && !filter.startsWith("channelmap=");
        assert.equal(result.exitCode, rejected ? 234 : 0, stderr);
        const output = Buffer.concat(stdout);
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)),
          rejected ? [] : expected);
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
