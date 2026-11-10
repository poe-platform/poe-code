import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = "102030405060708090a0b0c0";
const negated = "ef2030bf50608f80905fb0c0";

// Native FFmpeg 7 evaluates negate's enable predicate twice per input frame.
for (const [filter, expected] of [
  ["negate=components=r:enable=0", input],
  ["negate=components=r:enable=1", negated],
  ["negate=components=r:enable=ld(0)", input],
  ["negate=components=r:enable=not(ld(0))", negated],
  ["negate=components=r:enable='st(0,not(ld(0)))'", input],
  ["negate=components=r:enable='gt(st(0,ld(0)+1),2)'", input.slice(0, 12) + negated.slice(12)],
  ["negate=components=r:enable='eq(st(0,ld(0)+1),2)'", negated.slice(0, 12) + input.slice(12)],
  ["negate=components=r:enable='if(n,ld(0),st(0,1))'", negated],
  ["negate=components=r:enable='st(0,1)',negate=components=r:enable=ld(0)", negated]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} preserves expression registers (${graph ? "graph" : "simple"})`, async () => {
      const command = createFfmpegCommand();
      // Reusing the command must still initialize fresh registers for each run.
      for (let run = 0; run < 2; run++) {
        const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex") });
        const errors: Uint8Array[] = [];
        const result = await command.execute({
          args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "rgb24",
            "-video_size", "2x1", "-framerate", "2", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:v]${filter}[o]`, "-map", "[o]"] : ["-vf", filter]),
            "-pix_fmt", "rgb24", "-f", "rawvideo", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
        assert.equal((volume.readFileSync("/in.raw") as Buffer).toString("hex"), input);
      }
    });
  }
}
