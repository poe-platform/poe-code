import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, complex: boolean, format = "framecrc") {
  const volume = Volume.fromJSON({ "/in.rgb": Buffer.from(Array.from({ length: 60 }, (_, i) => i)) });
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "2x2",
      "-framerate", "5", "-i", "/in.rgb",
      ...(complex ? ["-filter_complex", `[0:v]${filter}[v]`, "-map", "[v]"] : ["-vf", filter]),
      "-fps_mode", "passthrough", "-c:v", "rawvideo", "-pix_fmt", "rgb24", "-f", format, "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, stdout: Buffer.concat(stdout) };
}

for (const complex of [false, true]) {
  // Native FFmpeg 7.0.2 selects only frame 1 from five 2x2 RGB24 frames at 5 fps.
  for (const [filter, frame] of [
    [String.raw`select=eq(n\,1)`, 1],
    [String.raw`select=gt(random(1)\,0.5)`, 1],
    [String.raw`select=gte(randomi(1\,0\,10)\,5)`, 1],
    ["select='gt(if(0,random(1),random(1)),0.5)'", 1],
    ["select='lt(random(1),0.5)',select='gt(random(1),0.5)'", 2]
  ] as const) {
    it(`keeps repeatable random selection and payloads (${complex ? "graph" : "simple"}): ${filter}`, async () => {
      for (let repeat = 0; repeat < 3; repeat++) {
        const actual = await run(filter, complex);
        assert.equal(actual.result.exitCode, 0, actual.stderr);
        const rows = actual.stdout.toString().split("\n").filter(line => line && !line.startsWith("#"))
          .map(line => line.split(",").map(field => field.trim()));
        assert.deepEqual(rows.map(row => row.slice(0, 5)), [["0", String(frame), String(frame), "1", "12"]]);
        const raw = await run(filter, complex, "rawvideo");
        assert.equal(raw.result.exitCode, 0, raw.stderr);
        assert.deepEqual(raw.stdout, Buffer.from(Array.from({ length: 12 }, (_, i) => frame * 12 + i)));
      }
    });
  }

  for (const filter of ["select='st(1,0);gt(random(1),0.5)'", "select=0,select='gt(random(1),0.5)'"]) {
    it(`accepts random selection producing no frames (${complex ? "graph" : "simple"}): ${filter}`, async () => {
      const actual = await run(filter, complex, "rawvideo");
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.equal(actual.stdout.length, 0);
    });
  }

  for (const expression of ["random()", "random(1,2)", "randomi(1,0)"]) {
    it(`rejects malformed select random calls (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const actual = await run(`select='${expression}'`, complex, "rawvideo");
      assert.notEqual(actual.result.exitCode, 0);
      assert.equal(actual.stdout.length, 0);
    });
  }
}
