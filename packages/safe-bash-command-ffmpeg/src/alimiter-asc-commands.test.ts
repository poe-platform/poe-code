import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete PCM16 references from native FFmpeg 7.0.2 for four loud/quiet pulses.
const manual = "1950ccd58f5902d5f7d4e912663d1f9ad62c1acc5187f2e121afcb409d4e0b75";
const automatic = "1caa80de7791ec59306c825abe8fef69656ec5538b8ea8a08d930195402d0613";
const changedLevel = "4b8f89bfc448ea4b91181a54a68fb3657b512100df9e58d5a84044da50839f7f";

async function render(graph: boolean, asc: number, ascLevel: number, schedule: string): Promise<Buffer> {
  const input = Buffer.alloc(240);
  for (let i = 0; i < 120; i++) input.writeInt16LE(i % 30 < 10 ? 30000 : 1500, i * 2);
  const fs = Volume.fromJSON({ "/in.raw": input });
  const filter = `asetnsamples=n=4:p=0,${schedule ? `asendcmd=c='${schedule}',` : ""}alimiter@l=attack=4:release=50:asc=${asc}:asc_level=${ascLevel}:level=0:limit=0.3:latency=0`;
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
      : ["-af", filter]), "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); } },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  const output = fs.readFileSync("/out.pcm") as Buffer;
  assert.equal(output.length, input.length);
  return output;
}

for (const graph of [false, true]) {
  for (const [asc, ascLevel, schedule, hash, unchangedSamples] of [
    [0, 0.5, "", manual, 0],
    [1, 0.5, "", automatic, 0],
    [1, 0.75, "", automatic, 0],
    [0, 0.5, "0 alimiter@l asc 1", automatic, 0],
    [0, 0.5, "0.024 alimiter@l asc 1", "c5dfcdc7cf6673d8587b49e61f6103d4f82a603613a7a401db95e16fc8a779d2", 24],
    [1, 0.5, "0 alimiter@l asc_level 0.75", "8ab8407180d8028b355267587b08c19c11a00d2bf0356c1811ab2c1f671686c6", 0],
    [1, 0.5, "0.024 alimiter@l asc_level 0.75", changedLevel, 24],
    [1, 0.5, "0.024 alimiter@l asc 0", "280b0e9436a454498895527b93297ab8f891487970e52c4d489ff26b093a3529", 24],
    [0, 0.5, "0.025 alimiter@l asc true", "c5dfcdc7cf6673d8587b49e61f6103d4f82a603613a7a401db95e16fc8a779d2", 28],
    [1, 0.5, "0.024 alimiter@l asc_level 3/4;0.048 alimiter@l asc_level 2", changedLevel, 24],
    [1, 0.5, "0.024 alimiter@l asc_level invalid", automatic, 120],
    [1, 0.5, "0.024 alimiter@l asc 2", automatic, 120],
    [0, 0.5, "0 alimiter@other asc 1", manual, 120],
    [1, 0.5, "0 alimiter@other asc_level 0.75", automatic, 120]
  ] as const) {
    it(`matches native limiter ASC for ${schedule || `static ${asc}:${ascLevel}`} (${graph ? "graph" : "simple"})`, async () => {
      const output = await render(graph, asc, ascLevel, schedule);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      if (unchangedSamples) {
        const baseline = await render(graph, asc, ascLevel, "");
        assert.deepEqual(output.subarray(0, unchangedSamples * 2), baseline.subarray(0, unchangedSamples * 2));
      }
    });
  }
}
