import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(option: string) {
  const samples = [32767, 0, -32768, 1000, 0, 7000, 1234, -20000, 400, 500, 32767, 0, -3000, 12000, 128, 128];
  const input = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
  const volume = Volume.fromJSON({ "/in.raw": input });
  const stdout: Buffer[] = [];
  let stderr = "";
  const expression = `showwavespic=s=2x4:${option}`;
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
      "-filter_complex", expression,
      "-frames:v", "1", "-pix_fmt", "rgba", "-bitexact", "-f", "rawvideo", "-"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: Buffer.concat(stdout) };
}

for (const [option, literal] of [
  ["scale=1+1", "scale=sqrt"], ["scale=default", "scale=lin"],
  ["scale=sqrt+1", "scale=cbrt"], ["scale=max", "scale=cbrt"],
  ["scale=1.5", "scale=sqrt"], ["scale=2.5", "scale=sqrt"],
  ["draw=1-1", "draw=scale"], ["draw=full", "draw=1"],
  ["draw=default", "draw=scale"], ["draw=0.5", "draw=scale"],
  ["draw=max", "draw=full"], ["filter=1-1", "filter=average"],
  ["filter=peak-1", "filter=average"], ["filter=default", "filter=average"],
  ["filter=max", "filter=peak"], ["filter=0.75", "filter=peak"]
]) {
  it(`evaluates showwavespic ${option} like ${literal}`, async () => {
    const expected = await run(literal!);
    const actual = await run(option!);
    assert.equal(expected.result.exitCode, 0, expected.stderr);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.deepEqual(actual.output, expected.output);
    if (literal === "scale=sqrt") {
      assert.equal(actual.output.toString("hex"), "00000000000000007f3f00fe7f3f00fe7f00007f7f00007f0000000000000000");
    }
  });
}

for (const option of ["scale", "draw", "filter"]) {
  for (const value of ["unknown", "1+", "0/0", "1/0", "-0.1", option === "scale" ? "3.1" : "1.1"]) {
    it(`rejects showwavespic ${option}=${value} before rendering`, async () => {
      const actual = await run(`${option}=${value}`);
      assert.notEqual(actual.result.exitCode, 0);
      assert.ok(actual.stderr.includes("showwavespic:"), actual.stderr);
      assert.equal(actual.output.length, 0);
    });
  }
}
