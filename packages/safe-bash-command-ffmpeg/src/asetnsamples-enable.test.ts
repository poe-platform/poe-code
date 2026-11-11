import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 11 }, (_, i) => i + 1);

async function run(filter: string, graph: boolean, keep = false, options: string[] = []) {
  const fs = createMemoryFileSystem();
  const input = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
  await fs.writeFile("/in.raw", input);
  if (keep) await fs.writeFile("/out.raw", new TextEncoder().encode("KEEP"));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      ...options, "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
    command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  return { ...result, stderr, fs };
}

// Native FFmpeg 7.0.2 reference: the first frame is grouped before enable is
// evaluated; subsequent consumption follows the previous frame's enabled state.
for (const graph of [false, true]) {
  for (const missingTimestamp of [false, true]) {
    for (const expression of ["isnan(t)", "lt(t,0.002)", "t"]) {
      it(`asetnsamples evaluates ${expression} with missing timestamp ${missingTimestamp} (graph ${graph})`, async () => {
        const enabled = expression === "isnan(t)" ? missingTimestamp : expression === "lt(t,0.002)" && !missingTimestamp;
        const result = await run(`${missingTimestamp ? "asetpts=NAN," : ""}asetnsamples=n=32:enable='${expression}'`, graph);
        assert.equal(result.exitCode, 0, result.stderr);
        const output = Buffer.from(await result.fs.readFile("/out.raw"));
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
          enabled ? [...samples, ...new Array<number>(32 - samples.length).fill(0)] : samples);
      });
    }
  }

  for (const [filter, expected, frames] of [
    ["asetnsamples=n=4:p=1:enable=0", samples, [[0, 4], [4, 7]]],
    ["asetnsamples=n=4:p=1:enable=1", [...samples, 0], [[0, 4], [4, 4], [8, 4]]],
    ["asetnsamples=n=4:p=1:enable=0,aselect='eq(n,2)'", [], []],
    ["asetnsamples=n=4:p=1:enable='lt(n,2)',aselect='eq(n,2)'", [9, 10, 11], [[8, 3]]],
    ["asetnsamples=n=4:p=1,aselect='eq(n,2)'", [9, 10, 11, 0], [[8, 4]]],
    ["asetnsamples=4:0:enable=1", samples, [[0, 4], [4, 4], [8, 3]]],
    ["asetnsamples=4:1:enable=0.25", samples, [[0, 4], [4, 7]]],
    ["asetnsamples=4:1:enable=-1", [...samples, 0], [[0, 4], [4, 4], [8, 4]]],
    ["asetnsamples=3:0,asetnsamples=4:1:enable=0", samples, [[0, 4], [4, 2], [6, 3], [9, 2]]],
    ["asetnsamples=3:0,asetnsamples=4:1:enable='gte(n,1)'", [1, 2, 3, 4, 5, 6, 0, 0, 7, 8, 9, 10, 11, 0, 0, 0], [[0, 4], [4, 4], [6, 4], [10, 4]]],
    ["asetnsamples=3:0,asetpts=PTS+8,asetnsamples=4:1:enable='lt(t,0.0015)'", samples, [[8, 4], [12, 4], [16, 1], [17, 2]]]
  ] as const) {
    it(`asetnsamples timeline ${filter} (graph ${graph})`, async () => {
      const result = await run(`${filter},ashowinfo`, graph);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = Buffer.from(await result.fs.readFile("/out.raw"));
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
      const lines = result.stderr.split("\n").filter(line => line.includes("nb_samples:"));
      assert.equal(lines.length, frames.length, result.stderr);
      frames.forEach(([pts, size], n) => {
        assert.ok(lines[n]!.includes(`n:${n} pts:${pts} `), lines[n]);
        assert.ok(lines[n]!.includes(`nb_samples:${size} `), lines[n]);
      });
    });
  }

  for (const [filter, expected] of [
    ["aloop=-1:11,asetnsamples=4:1:enable=0", [...samples, ...samples, ...samples]],
    ["aloop=-1:11,asetnsamples=4:1:enable='lt(n,2)'", [...samples, ...samples]],
    ["apad=packet_size=8,asetnsamples=4:1:enable=0", [...samples, ...new Array<number>(16).fill(0)]],
    ["apad=packet_size=2,asetnsamples=4:1:enable=0", [...samples, 0, 0, 0, 0]]
  ] as const) {
    it(`asetnsamples timeline honors output frame limits after ${filter} (graph ${graph})`, async () => {
      const result = await run(filter, graph, false, ["-frames:a", "4"]);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = Buffer.from(await result.fs.readFile("/out.raw"));
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
    });
  }

  for (const enable of ["", "unknown", "gte(t)", "1+"]) {
    it(`asetnsamples rejects enable=${enable} without replacing output (graph ${graph})`, async () => {
      const result = await run(`asetnsamples=4:1:enable=${enable}`, graph, true);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("asetnsamples"), result.stderr);
      assert.equal(new TextDecoder().decode(await result.fs.readFile("/out.raw")), "KEEP");
    });
  }
}
