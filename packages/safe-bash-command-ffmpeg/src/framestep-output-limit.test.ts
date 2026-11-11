import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Frame repetitions verified against FFmpeg 7.0.2, including output seeks.
for (const offset of [true, false]) {
  for (const [mode, graph] of [["auto", false], ["cfr", false], ["vfr", false], ["passthrough", false], ["auto", true]] as const) {
    for (const limit of [[], ["-t", "1"], ["-to", "1"], ["-t", "0.7"], ["-ss", "0.5", "-t", "1"]]) {
      it(`preserves synchronized framestep frames with ${offset ? "input offset" : "setpts"}, ${mode}, ${graph ? "graph" : "simple"}, ${limit.join(" ") || "unbounded"}`, async () => {
        const source = Buffer.from(Array.from({ length: 44 }, (_, index) => Math.floor(index / 4) + 1));
        const volume = Volume.fromJSON({ "/in.raw": source });
        let stderr = "";
        const filter = `${offset ? "" : "setpts=PTS+3,"}framestep=3`;
        // A short limit must stop duplication before it exhausts the frame budget.
        const result = await createFfmpegCommand(!offset && mode === "auto" && !graph && limit.includes("0.7")
          ? { limits: { maxFrames: 16 } } : {}).execute({
          args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x2",
            "-framerate", "6", ...(offset ? ["-itsoffset", "0.5"] : []), "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
            ...(mode === "auto" ? [] : ["-fps_mode", mode]), ...limit, "-f", "rawvideo", "/out.raw"],
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
        const cfr = mode === "auto" || mode === "cfr";
        const padsStart = mode === "cfr" || graph;
        const unbounded = limit.length === 0;
        const seek = limit.includes("-ss");
        const fractional = limit.includes("0.7");
        const repeats = !offset && cfr
          ? unbounded ? [padsStart ? 24 : 11, 13, 12, 12]
            : fractional ? [padsStart ? 18 : 5]
              : [seek ? 12 : padsStart ? 24 : 11, 1]
          : unbounded ? [1, 1, 1, 1] : cfr || seek ? [1, 1] : [1];
        const expected = Buffer.from(repeats.flatMap((count, index) => Array.from({ length: count * 4 }, () => index * 3 + 1)));
        assert.deepEqual(volume.readFileSync("/out.raw"), expected);
        assert.deepEqual(volume.readFileSync("/in.raw"), source);
      });
    }
  }
}
