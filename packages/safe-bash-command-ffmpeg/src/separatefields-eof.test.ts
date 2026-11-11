import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: separatefields reports EOF at the final field's PTS.
for (const [filter, oneFrame, threeFrames, start] of [
  ["separatefields", "1b220d14", "1b220d14373e2930535a454c", 0],
  ["separatefields,fps=4", "1b22", "1b220d14373e2930535a", 0],
  ["select=eq(n\\,0),separatefields,fps=4", "1b22", "1b221b221b22", 0],
  ["setpts=2*PTS,separatefields,fps=4", "1b221b22", "1b221b220d140d14373e373e29302930535a535a", 0],
  ["separatefields,select=eq(n\\,0),fps=4", "1b22", "1b221b221b221b221b22", 0],
  ["separatefields,setpts=PTS+2,fps=4", "1b22", "1b220d14373e2930535a", 2],
  ["separatefields,fps=3:round=down:eof_action=pass", "0d14", "0d14373e2930454c", 0]
] as const) {
  for (const count of [1, 3]) {
    for (const graph of [false, true]) {
      it(`${filter} preserves ${count}-frame EOF timing (${graph ? "graph" : "simple"})`, async () => {
        const input = Buffer.from(Array.from({ length: count * 4 }, (_, i) => 13 + 7 * i));
        const volume = Volume.fromJSON({ "/in.raw": input });
        const output: Uint8Array[] = [];
        let stderr = "";
        const chain = `${filter},showinfo`;
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray",
            "-s", "2x2", "-r", "2", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:v]${chain}[v]`, "-map", "[v]"] : ["-vf", chain]),
            "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
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
        const expected = Buffer.from(count === 1 ? oneFrame : threeFrames, "hex");
        assert.deepEqual(Buffer.concat(output), expected);
        const info = stderr.split("\n").filter(line => line.includes(" pts:"));
        assert.equal(info.length, expected.length / 2, stderr);
        for (const [index, line] of info.entries()) {
          const tokens = line.split(" ").filter(Boolean);
          assert.equal(tokens.find(token => token.startsWith("pts:"))?.slice(4), String(start + index), line);
          assert.equal(tokens.find(token => token.startsWith("duration:"))?.slice(9), "1", line);
        }
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
