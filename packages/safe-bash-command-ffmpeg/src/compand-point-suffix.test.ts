import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: a completed output number may have a slash suffix.
const expected = Buffer.from("00000f00000081ff0000f401000048f40000606d0000c5b50000b90b00006400", "hex");
for (const graph of [false, true]) {
  for (const points of ["-70/-70|0/0", "-70/-70/2|0/0", "-70/-70/|0/0", "-70/-70/ignored|0/0/2", "-70/|0/0", "-70//2|0/0"]) {
    for (const target of ["pipe:1", "/out.pcm"]) {
      it(`compand points ${points}, ${graph ? "graph" : "simple"}, ${target}`, async () => {
        const fs = Volume.fromJSON({ "/out.pcm": "keep" });
        fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
          Float64Array.from([15, -127, 500, -3000, 28000, -19003, 3001, 100], sample => sample / 32768)
        ] }));
        const filter = `compand=points=${points}`;
        const output: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
            : ["-af", filter]), "-f", "s32le", target],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
            async stat(path: string) { return fs.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        const missingOutput = points.startsWith("-70/|") || points.startsWith("-70//");
        assert.equal(result.exitCode, missingOutput ? 234 : 0, stderr);
        const actual = target === "pipe:1" ? Buffer.concat(output) : fs.readFileSync(target);
        assert.deepEqual(actual, missingOutput ? Buffer.alloc(0) : expected);
        if (missingOutput) assert.ok(stderr.includes("compand"), stderr);
        else assert.equal(stderr, "");
      });
    }
  }
}
