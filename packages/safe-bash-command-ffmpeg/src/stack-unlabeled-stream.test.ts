import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(graph: string, extraInput = true) {
  const volume = Volume.fromJSON({
    "/a.gray": Buffer.from([10, 11, 20, 21, 30, 31]),
    "/b.gray": Buffer.from([100, 101, 110, 111])
  });
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error",
      "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x1", "-framerate", "2", "-i", "/a.gray",
      ...(extraInput ? ["-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x1", "-framerate", "2", "-i", "/b.gray"] : []),
      "-filter_complex", `${graph}[out]`, "-map", "[out]", "-fps_mode", "passthrough",
      "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(data: Uint8Array) { stdout.push(data); } },
    stderr: { async write(data: Uint8Array) { stderr.push(data); } }
  } as never);
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
}

// Expected bytes were verified against native FFmpeg with these raw gray inputs.
for (const filter of ["hstack", "vstack", "xstack"]) {
  for (const pads of ["[1:v]", "[1:v][0:v]", "[1:v]null[b];[b]", "[1:v]null[b];[b]null[c];[c]"]) {
    it(`${filter} selects the unused first stream after ${pads}`, async () => {
      const result = await run(`${pads}${filter}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout.toString("hex"), "64650a0b6e6f14156e6f1e1f");
    });
  }

  for (const pads of ["", "[0:v]"]) {
    it(`${filter} selects unused streams in input order after ${pads || "no labels"}`, async () => {
      const result = await run(`${pads}${filter}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout.toString("hex"), "0a0b646514156e6f1e1f6e6f");
    });
  }

  it(`${filter} rejects an unlabeled pad when every video stream is used`, async () => {
    const result = await run(`[0:v]${filter}`, false);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("unavailable"), result.stderr);
    assert.equal(result.stdout.length, 0);
  });
}
