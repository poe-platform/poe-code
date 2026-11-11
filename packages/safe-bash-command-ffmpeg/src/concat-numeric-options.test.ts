import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const first = Array.from({ length: 11 }, (_, index) => (index + 1) * 100);

async function run(graph: string, inputs: number[][]) {
  const volume = Volume.fromJSON({ "/out.raw": "keep" });
  inputs.forEach((samples, index) => {
    const bytes = Buffer.alloc(samples.length * 2);
    samples.forEach((sample, offset) => bytes.writeInt16LE(sample, offset * 2));
    volume.writeFileSync(`/${index}.raw`, bytes);
  });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", ...inputs.flatMap((_, index) =>
      ["-f", "s16le", "-ac", "1", "-ar", "1000", "-i", `/${index}.raw`]),
    "-filter_complex", graph, "-map", "[out]", "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}

for (const options of [
  "n=1+1:v=0:a=1", "n=1.75:v=0:a=1", "n=2:v=1-1:a=1",
  "n=2:v=0:a=2-1", "n=2.5:v=0:a=1", "n=1.5:v=0.5:a=1.4",
  "1+1:1-1:2-1", "n=default:v=min:a=1", "n=2:v=0:a=1"
]) {
  it(`evaluates and rounds concat numeric options: ${options}`, async () => {
    const result = await run(`[0:a][0:a]concat=${options}[out]`, [first]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(Array.from({ length: result.output.length / 2 }, (_, i) => result.output.readInt16LE(i * 2)),
      [...first, ...first]);
  });
}

for (const options of [
  "n=0.75:v=0:a=1", "n=2:v=-0.1:a=1", "n=2:v=0:a=-0.1",
  "n=2147483647+1:v=0:a=1", "n=2:v=2147483647+1:a=1",
  "n=2:v=0:a=2147483647+1", "n=1/0:v=0:a=1", "n=unknown:v=0:a=1",
  "n=3:v=0:a=1"
]) {
  it(`rejects invalid concat numeric options without replacing output: ${options}`, async () => {
    const result = await run(`[0:a][0:a]concat=${options}[out]`, [first]);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.output.toString(), "keep");
  });
}
