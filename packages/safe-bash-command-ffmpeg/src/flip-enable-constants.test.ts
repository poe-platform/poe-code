import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from("0d141b222930373e", "hex");
for (const [direction, flipped, secondOnly] of [
  ["hflip", "140d221b30293e37", "0d141b2230293e37"],
  ["vflip", "1b220d14373e2930", "0d141b22373e2930"]
] as const) {
  for (const graph of [false, true]) {
    for (const [expression, prefix, expected] of [
      ["PI", "", flipped], ["E", "", flipped], ["PHI", "", flipped],
      ["PI-PI", "", input.toString("hex")],
      ["E-E", "", input.toString("hex")],
      ["PHI-PHI", "", input.toString("hex")],
      ["gt(n,PI-3)", "", secondOnly],
      ["gt(n,E-2)", "", secondOnly],
      ["gt(n,PHI-1)", "", secondOnly],
      ["PI", "trim=end_frame=0,", ""],
      ["E", "trim=end_frame=0,", ""],
      ["PHI", "trim=end_frame=0,", ""],
      ["0", `sendcmd='0.04 ${direction} enable PI',`, secondOnly],
      ["0", `sendcmd='0.04 ${direction} enable E',`, secondOnly],
      ["0", `sendcmd='0.04 ${direction} enable PHI',`, secondOnly]
    ] as const) {
      const filter = `${prefix}${direction}=enable='${expression}'`;
      it(`${filter} (${graph ? "graph" : "simple"}) accepts expression constants`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input });
        const output: Uint8Array[] = [];
        const errors: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
            "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        assert.equal(Buffer.concat(output).toString("hex"), expected);
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
