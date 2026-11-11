import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(graph: string, extraInput?: string) {
  const volume = Volume.fromJSON({
    "/a.gray": Buffer.from([10, 11, 20, 21, 30, 31]),
    "/b.gray": Buffer.from([100, 101, 110, 111])
  });
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error",
      "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x1", "-framerate", "2", "-i", "/a.gray",
      ...(extraInput ? ["-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x1", "-framerate", "2", "-i", extraInput] : []),
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

for (const filter of ["hstack", "vstack", "xstack"]) {
  for (const extraInput of [undefined, "/b.gray"]) {
    for (const split of ["split", "split=2", "split=outputs=2", "split@copy=2"]) {
      it(`${filter} routes both ${split} branches with ${extraInput ?? "one input"}`, async () => {
        const result = await run(`[0:v]${split}[l][r];[r]hflip[h];[l][h]${filter}`, extraInput);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout.toString("hex"), "0a0b0b0a141515141e1f1f1e");
      });
    }
  }
}

it("matches loading the same clip twice and flipping the second input", async () => {
  const result = await run("[1:v]hflip[h];[0:v][h]hstack", "/a.gray");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString("hex"), "0a0b0b0a141515141e1f1f1e");
});

it("applies filters before a split to both branches", async () => {
  const result = await run("[0:v]hflip,split[l][r];[r]hflip[h];[l][h]hstack");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString("hex"), "0b0a0a0b151414151f1e1e1f");
});

it("routes all three named split outputs", async () => {
  const result = await run("[0:v]split=3[a][b][c];[b]hflip[h];[a][h][c]hstack=3");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString("hex"), "0a0b0b0a0a0b1415151414151e1f1f1e1e1f");
});

for (const split of ["split=0", "split=3", "split=outputs=1", "split=unknown=2", "null"]) {
  it(`rejects ${split} with two named outputs`, async () => {
    const result = await run(`[0:v]${split}[l][r];[l][r]hstack`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stdout.length, 0);
  });
}
