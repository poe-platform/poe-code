import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const valid = "in_gain=0.7:out_gain=0.9:delays=2|3:decays=0.7|0.21";
// Native FFmpeg 7.0.2 statuses and complete PCM for the same input and options.
for (const [options, exitCode] of [
  [`in_gain=-1:${valid}`, 222],
  [`in_gain=2:${valid}`, 222],
  [`out_gain=abc:${valid}`, 234],
  [`out_gain=-1:${valid}`, 222],
  [`out_gain=2:${valid}`, 222],
  [`in_gain=abc:${valid}`, 234],
  [`-1:0.9:2|3:0.7|0.21:${valid}`, 222],
  [`in_gain=0.1:${valid}`, 0],
  [`out_gain=0.1:${valid}`, 0],
  [`delays=abc:${valid}`, 0],
  [`decays=10:${valid}`, 0],
  [valid, 0],
  [`${valid}:in_gain=-1`, 222],
  [`${valid}:out_gain=abc`, 234]
] as const) {
  for (const graph of [false, true]) {
    it(`aecho validates each gain assignment: ${options} (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(12);
      [20001, 0, -5005, 0, 0, 123].forEach((value, index) => input.writeInt16LE(value, index * 2));
      const volume = Volume.fromJSON({ "/in.pcm": input });
      const output: Buffer[] = [];
      let stderr = "";
      const filter = `aecho=${options}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.pcm",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, exitCode, stderr);
      assert.equal(Buffer.concat(output).toString("hex"), exitCode ? "" : "38310000e724c40eaff39cfc00004d001700");
    });
  }
}
