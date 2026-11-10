import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(8 * 4);
for (let i = 0; i < 8; i++) {
  input.writeInt16LE(100 * (i + 1), i * 4);
  input.writeInt16LE(-100 * (i + 1), i * 4 + 2);
}

// Complete PCM16 stereo output captured with native FFmpeg 7.0.2.
const cases: [string, number[][]][] = [
  ["areverse", [[0, 0], [0, -800], [0, -700], [800, -600], [700, -500], [600, -400], [500, -300], [400, -200], [300, -100], [200, 0], [100, 0]]],
  ["atrim=start_sample=2", [[0, 0], [0, -300], [0, -400], [300, -500], [400, -600], [500, -700], [600, -800], [700, 0], [800, 0]]],
  ["asetnsamples=n=4:p=0", [[0, 0], [0, -100], [0, -200], [100, -300], [200, -400], [300, -500], [400, -600], [500, -700], [600, -800], [700, 0], [800, 0]]],
  ["adelay=2S|3S", [[0, 0], [0, 0], [100, 0], [200, -100], [0, 0], [0, -200], [0, -300], [300, -400], [400, -500], [500, -600], [600, -700], [700, -800], [800, 0], [0, 0]]],
  ["", [[100, -100], [200, -200], [0, 0], [0, -300], [0, -400], [300, -500], [400, -600], [500, -700], [600, -800], [700, 0], [800, 0]]]
];

for (const graph of [false, true]) {
  for (const [intervening, expected] of cases) {
    it(`sends timed delay changes through ${intervening || "a direct connection"} (graph ${graph})`, async () => {
      const fs = Volume.fromJSON({ "/in.raw": input });
      let stderr = "";
      const chain = ["asetnsamples=n=2:p=0", "asendcmd=c='0.00025 adelay@d delays 3S|1S'", intervening, "adelay@d=0S|0S"].filter(Boolean).join(",");
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
          "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); } },
        stdin: (async function* () {})(),
        stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = Buffer.alloc(expected.length * 4);
      expected.flat().forEach((sample, index) => pcm.writeInt16LE(sample, index * 2));
      assert.deepEqual(fs.readFileSync("/out.raw"), pcm);
    });
  }
}
