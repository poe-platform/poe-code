import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(8 * 4);
for (let i = 0; i < 8; i++) {
  input.writeInt16LE(i + 1, i * 4);
  input.writeInt16LE(-i - 1, i * 4 + 2);
}

async function run(filter: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/in.raw": input });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); } },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const output = fs.readFileSync("/out.raw") as Buffer;
  return Array.from({ length: output.length / 4 }, (_, i) =>
    [output.readInt16LE(i * 4), output.readInt16LE(i * 4 + 2)]);
}

for (const graph of [false, true]) {
  it(`adelay preserves registers between input frames (graph ${graph})`, async () => {
    const filter = "asetnsamples=n=2:p=0,adelay=1S|3S:enable='st(0,not(ld(0)))',asetpts=N/SR/TB";
    const actual = await run(filter, graph);
    // Complete native FFmpeg 7.0.2 output, including common silence and the tail.
    assert.deepEqual(actual, [[0, 0], [1, 0], [2, 0], [3, -3], [4, -4],
      [5, -1], [6, -2], [7, -7], [8, -8], [0, 0], [0, 0]]);
    assert.deepEqual(actual, await run(filter.replace("st(0,not(ld(0)))", "not(mod(n,2))"), graph));
  });

  it(`adelay initializes unwritten registers to zero (graph ${graph})`, async () => {
    const actual = await run("adelay=1S|3S:enable=ld(0)", graph);
    assert.deepEqual(actual, [[0, 0], [1, -1], [2, -2], [3, -3], [4, -4],
      [5, -5], [6, -6], [7, -7], [8, -8], [0, 0], [0, 0]]);
    assert.deepEqual(actual, await run("adelay=1S|3S:enable=0", graph));
  });

  it(`adelay keeps registers separate for each filter instance (graph ${graph})`, async () => {
    const filter = "asetnsamples=n=2:p=0,adelay=0S|0S:enable='st(0,9)',adelay=1S|3S:enable=ld(0),asetpts=N/SR/TB";
    assert.deepEqual(await run(filter, graph), await run(filter.replace("enable=ld(0)", "enable=0"), graph));
  });

  it(`adelay evaluates register sequences and only the selected conditional branch (graph ${graph})`, async () => {
    const filter = "asetnsamples=n=2:p=0,adelay=1S|3S:enable='if(0,st(0,99));st(0,ld(0)+1);mod(ld(0),2)',asetpts=N/SR/TB";
    assert.deepEqual(await run(filter, graph), await run("asetnsamples=n=2:p=0,adelay=1S|3S:enable='not(mod(n,2))',asetpts=N/SR/TB", graph));
  });

  for (const [expression, reference] of [
    ["st(0,not(ld(0)))", "mod(n,2)"],
    ["st(0,99)+invalid", "not(mod(n,2))"],
  ]) {
    it(`adelay ${expression!.includes("invalid") ? "retains registers after rejecting" : "resets registers when replacing"} a runtime expression (graph ${graph})`, async () => {
      const filter = `asetnsamples=n=2:p=0,asendcmd=c='0.00025 adelay@d enable ${expression}',adelay@d=1S|3S:enable='st(0,not(ld(0)))',asetpts=N/SR/TB`;
      const control = `asetnsamples=n=2:p=0,adelay=1S|3S:enable='eq(n,0)+gt(n,0)*(${reference})',asetpts=N/SR/TB`;
      assert.deepEqual(await run(filter, graph), await run(control, graph));
    });
  }
}
