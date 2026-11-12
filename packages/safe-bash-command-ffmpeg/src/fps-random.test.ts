import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 60 }, (_, i) => i));

async function run(filter: string, complex: boolean) {
  const volume = Volume.fromJSON({ "/in.rgb": input });
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "2x2",
      "-framerate", "5", "-i", "/in.rgb",
      ...(complex ? ["-filter_complex", `[0:v]${filter}[v]`, "-map", "[v]"] : ["-vf", filter]),
      "-fps_mode", "passthrough", "-c:v", "rawvideo", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"],
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
  // Native FFmpeg 7.0.2 emits complete source frames 0, 2, 4 on every invocation.
  for (const filter of [
    "fps=3",
    "fps=round(2+random(1)*4)",
    String.raw`fps=round(randomi(1\,2\,6))`,
    "fps='round(2+if(0,random(1),random(1))*4)'",
    "fps='st(1,0);round(2+random(1)*4)'",
    "fps=round(2+random(1)*4),fps=round(2+random(1)*4)"
  ]) {
    it(`evaluates a repeatable fps rate (${complex ? "graph" : "simple"}): ${filter}`, async () => {
      for (let repeat = 0; repeat < 3; repeat++) {
        const actual = await run(filter, complex);
        assert.equal(actual.result.exitCode, 0, actual.stderr);
        assert.deepEqual(actual.stdout, Buffer.concat([0, 2, 4].map(i => input.subarray(i * 12, (i + 1) * 12))));
      }
    });
  }

  for (const expression of ["random()", "random(1,2)", "randomi(1,2)", "randomi(1,2,6,8)"]) {
    it(`rejects invalid fps random arguments (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const actual = await run(`fps='${expression}'`, complex);
      assert.equal(actual.result.exitCode, 234, actual.stderr);
      assert.equal(actual.stdout.length, 0);
    });
  }
}
