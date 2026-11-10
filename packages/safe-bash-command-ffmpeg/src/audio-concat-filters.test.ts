import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Array.from({ length: 11 }, (_, i) => (i + 1) * 100);
for (const [name, graph, other, expected] of [
  ["plain join", "[0:a][1:a]concat=n=2:v=0:a=1[out]", [-10, -20, -30], [...input, -10, -20, -30]],
  ["reverse joined samples", "[0:a][1:a]concat=n=2:v=0:a=1,areverse[out]", [-10, -20, -30], [-30, -20, -10, ...[...input].reverse()]],
  ["select upstream frame", "[0:a]asetnsamples=n=4:p=0[a];[1:a]asetnsamples=n=4:p=0,anull[r];[a][r]concat=n=2:v=0:a=1,aselect=eq(n\\,1)[out]", input, [500, 600, 700, 800]],
  ["filter labeled join", "[1:a][0:a]concat=n=2:v=0:a=1[join];[join]areverse[out]", [-10, -20, -30], [...[...input].reverse(), -30, -20, -10]]
] as const) {
  it(`audio concat: ${name}`, async () => {
    const fs = Volume.fromJSON({});
    for (const [path, values] of [["/in.raw", input], ["/other.raw", other]] as const) {
      const bytes = Buffer.alloc(values.length * 2);
      values.forEach((value, index) => bytes.writeInt16LE(value, index * 2));
      fs.writeFileSync(path, bytes);
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ac", "1", "-ar", "1000", "-i", "/in.raw",
        "-f", "s16le", "-ac", "1", "-ar", "1000", "-i", "/other.raw", "-filter_complex", graph,
        "-map", "[out]", "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); },
        async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); },
        async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const bytes = fs.readFileSync("/out.raw") as Buffer;
    assert.deepEqual(Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2)), expected);
  });
}
