import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(32 * 4);
for (let i = 0; i < 32; i++) {
  input.writeInt16LE(100 + i, i * 4);
  input.writeInt16LE(-200 - i, i * 4 + 2);
}

async function run(filter: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/in.raw": input });
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const chain = `asetnsamples=8:0,${filter}`;
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
      "-f", "s16le", "-"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); } },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return Buffer.concat(stdout);
}

for (const graph of [false, true]) {
  it(`disables the named delay at 2 ms, preserving both channels and its tail (graph ${graph})`, async () => {
    const output = await run("asendcmd=c='0.002 adelay@d enable 0',adelay@d=3S|0S", graph);
    // Native FFmpeg 7.0.2, including all 35 stereo sample pairs.
    assert.equal(createHash("sha256").update(output).digest("hex"),
      "fdaf90c3a24cf519a0f081eb210924f08fe43e6903703f46d42eec3aaf21093a");
    assert.equal(output.length, 35 * 4);
    assert.deepEqual([...output.subarray(16 * 4, 17 * 4)], [116, 0, 40, 255]);
    assert.deepEqual(output.subarray(-12), Buffer.alloc(12));
    assert.deepEqual(output, await run("adelay=3S|0S:enable='lt(n,2)'", graph));
  });

  for (const [commands, filters, reference] of [
    ["0.0015 adelay@d enable 0", "adelay@d=3S|0S", "adelay=3S|0S:enable='lt(n,2)'"],
    ["0 adelay@d enable 0;0.002 adelay@d enable 1", "adelay@d=3S|0S", "adelay=3S|0S:enable='gte(n,2)'"],
    ["0.001 adelay@d enable 0;0.003 adelay@d enable 1", "adelay@d=3S|0S", "adelay=3S|0S:enable='eq(n,0)+gte(n,3)'"],
    ["0.001 adelay@d enable lt(n,2)", "adelay@d=3S|0S", "adelay=3S|0S:enable='lt(n,2)'"],
    ["0.001 adelay@d enable 0;0.002 adelay@d enable invalid", "adelay@d=3S|0S", "adelay=3S|0S:enable='lt(n,1)'"],
    ["0.001 adelay@missing enable 0", "adelay@d=3S|0S", "adelay=3S|0S"],
    ["0.004 adelay@d enable 0", "adelay@d=3S|0S", "adelay=3S|0S"],
    ["0.002 adelay enable 0", "adelay@first=3S|0S,adelay@second=0S|2S", "adelay=3S|0S:enable='lt(n,2)',adelay=0S|2S"],
    ["0.002 adelay@second enable 0", "adelay@first=0S|0S,adelay@second=3S|0S", "adelay=0S|0S,adelay=3S|0S:enable='lt(n,2)'"],
    ["0.002 adelay@d enable 0", "adelay@d=3S|5S", "adelay=3S|5S:enable='lt(n,2)'"],
    ["0.001 adelay@d delays 5S|0S;0.002 adelay@d enable 0", "adelay@d=3S|0S", "asendcmd=c='0.001 adelay@d delays 5S|0S',adelay@d=3S|0S:enable='lt(n,2)'"],
    ["0.001 adelay@d enable 0;0.002 adelay@d delays 5S|0S;0.003 adelay@d enable 1", "adelay@d=3S|0S", "asendcmd=c='0.002 adelay@d delays 5S|0S',adelay@d=3S|0S:enable='eq(n,0)+gte(n,3)'"],
  ]) {
    it(`scheduled delay enable: ${commands} on ${filters} (graph ${graph})`, async () => {
      const expected = await run(reference!, graph);
      assert.deepEqual(await run(`asendcmd=c='${commands}',${filters}`, graph), expected);
    });
  }
}
