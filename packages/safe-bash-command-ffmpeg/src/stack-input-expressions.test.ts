import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(graph: string, output = "pipe:1") {
  const volume = Volume.fromJSON({
    "/a.gray": Buffer.from([10, 11, 20, 21, 30, 31]),
    "/b.gray": Buffer.from([100, 101, 110, 111]),
    "/out.gray": "preserve"
  });
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error",
      "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x1", "-framerate", "2", "-i", "/a.gray",
      "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x1", "-framerate", "2", "-i", "/b.gray",
      "-filter_complex", `${graph}[out]`, "-map", "[out]", "-fps_mode", "passthrough",
      "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", output],
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
  return { ...result, volume, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
}

for (const filter of ["hstack", "vstack", "xstack"]) {
  for (const option of ["", "=inputs=2", "=inputs=1+1", "=inputs=default", "=1+1", "=default",
    "=inputs=min", "=inputs=max-(max-2)", "=inputs=2.49", "=inputs=2.5", "=inputs=default+0.5"]) {
    it(`evaluates ${filter}${option} input counts and preserves frame timing`, async () => {
      const result = await run(`[0:v][1:v]${filter}${option}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout.toString("hex"), "0a0b646514156e6f1e1f6e6f");
    });
  }

  for (const count of ["", "1.9", "min-0.1", "max+1", "NaN", "Infinity", "1/0", "0/0", "1+", "DEFAULT", "2.51", "3"]) {
    it(`rejects ${filter} inputs=${count} without replacing output`, async () => {
      const result = await run(`[0:v][1:v]${filter}=inputs=${count}`, "/out.gray");
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes(filter), result.stderr);
      assert.equal(result.stdout.length, 0);
      assert.equal(result.volume.readFileSync("/out.gray", "utf8"), "preserve");
    });
  }
}
