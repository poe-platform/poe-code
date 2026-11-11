import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, graph: boolean): Promise<Buffer> {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/in.wav", encodeWav({
    sampleRate: 48000, channels: [new Float64Array(128).fill(16000 / 32768)]
  }));
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  assert.equal(Buffer.concat(errors).toString(), "");
  const pcm = Buffer.concat(output);
  assert.equal(pcm.length, 256);
  return pcm;
}

for (const graph of [false, true]) {
  // Native Linux FFmpeg 7.0.2: 128 constant PCM16 samples at 48 kHz.
  for (const [filter, hash] of [
    ["asendcmd=c=0.001 aexciter enable 0,aexciter=listen=1", "39b6732b24a2e1d76891a19c82bf663413255bccf3b5bca1f8f26e8b3ba7e5d1"],
    ["aexciter=listen=1:enable='lt(t,0.001)'", "39b6732b24a2e1d76891a19c82bf663413255bccf3b5bca1f8f26e8b3ba7e5d1"],
    ["aexciter=listen=1", "df7d1210eb7268706c08386c58d74855981cc67f1ee5d698a0e6910d5d65dac1"],
    ["anull", "364ea04dbbe98aaab6799d7725dbe75a56625498165e1c4ee6480d5bbf15cbce"]
  ]) {
    it(`matches native aexciter PCM for ${filter} (graph=${graph})`, async () => {
      const pcm = await run(`asetnsamples=n=16:p=0,${filter}`, graph);
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    });
  }

  it(`re-enables a named exciter with its continuously updated history (graph=${graph})`, async () => {
    const expected = await run("asetnsamples=16:0,aexciter=listen=1:enable='lt(n,3)+gte(n,6)'", graph);
    const actual = await run("asetnsamples=16:0,asendcmd=c='0.0009 aexciter@fx enable 0;0.002 aexciter@fx enable 1',aexciter@fx=listen=1", graph);
    assert.deepEqual(actual, expected);
  });

  it(`replaces the enable expression and resets its registers (graph=${graph})`, async () => {
    const expected = await run("asetnsamples=16:0,aexciter=listen=1:enable='eq(n,2)+gte(n,5)'", graph);
    const actual = await run("asetnsamples=16:0,asendcmd=c='0.001 aexciter enable gte(st(0,ld(0)+1),5)',aexciter=listen=1:enable='gte(st(0,ld(0)+1),5)'", graph);
    assert.deepEqual(actual, expected);
  });

  it(`retains the enable expression after a rejected command (graph=${graph})`, async () => {
    const expected = await run("asetnsamples=16:0,aexciter=listen=1:enable='gte(st(0,ld(0)+1),7)'", graph);
    const actual = await run("asetnsamples=16:0,asendcmd=c='0.001 aexciter enable unknown',aexciter=listen=1:enable='gte(st(0,ld(0)+1),7)'", graph);
    assert.deepEqual(actual, expected);
  });
}
