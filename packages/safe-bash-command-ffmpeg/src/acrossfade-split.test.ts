import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Array.from({ length: 11 }, (_, index) => (index + 1) * 100);
const prefix = input.slice(0, 8);

// PCM output from FFmpeg 7.0.2: simultaneous split EOF ends before the fade.
for (const [name, graph, expected] of [
  ["direct split", "[0:a]asetnsamples=n=4:p=0,asplit[a][b];[a][b]acrossfade=ns=3[out]", prefix],
  ["unbuffered second branch", "[0:a]asetnsamples=n=4:p=0,asplit[a][b];[b]anull[r];[a][r]acrossfade=ns=3[out]", prefix],
  ["unbuffered branch chains", "[0:a]asplit[a][b];[b]anull,acopy[r];[a]acopy[l];[l][r]acrossfade=ns=3[out]", prefix],
  ["nonoverlapping fades", "[0:a]asplit[a][b];[a][b]acrossfade=ns=3:o=0[out]", prefix],
  ["duration option and named instance", "[0:a]asplit[a][b];[a][b]acrossfade@join=d=0.003[out]", prefix],
  ["fade as long as input", "[0:a]asplit[a][b];[a][b]acrossfade=ns=11[out]", []],
  ["buffering before split", "[0:a]areverse,asplit[a][b];[a][b]acrossfade=ns=3[out]", [...input].reverse().slice(0, 8)],
  ["buffered second branch", "[0:a]asetnsamples=n=4:p=0,asplit[a][b];[b]areverse[r];[a][r]acrossfade=ns=3[out]",
    [...prefix, 600, 666, 600, 800, 700, 600, 500, 400, 300, 200, 100]],
  ["reframed second branch", "[0:a]asetnsamples=n=4:p=0,asplit[a][b];[b]asetnsamples=n=4:p=0[r];[a][r]acrossfade=ns=3[out]",
    [...prefix, 600, 400, 200, ...input.slice(3)]],
  ["independent inputs", "[0:a]asetnsamples=n=4:p=0[a];[1:a]asetnsamples=n=4:p=0,anull[r];[a][r]acrossfade=ns=3[out]",
    [...prefix, 600, 400, 200, ...input.slice(3)]]
] as const) {
  it(`matches acrossfade split EOF for ${name}`, async () => {
    const volume = Volume.fromJSON({});
    const bytes = Buffer.alloc(input.length * 2);
    input.forEach((sample, index) => bytes.writeInt16LE(sample, index * 2));
    volume.writeFileSync("/in.raw", bytes);
    let stderr = "";
    const args = ["-f", "s16le", "-ac", "1", "-ar", "1000", "-i", "/in.raw"];
    const result = await createFfmpegCommand().execute({
      args: [...args, ...(name === "independent inputs" ? args : []), "-filter_complex", graph,
        "-map", "[out]", "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = volume.readFileSync("/out.raw") as Buffer;
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)), expected);
  });
}
