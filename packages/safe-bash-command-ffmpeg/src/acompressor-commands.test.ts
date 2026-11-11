import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Array<number>(8).fill(8000);
for (const graph of [false, true]) {
  for (const [command, compressors, expected] of [
    ["0.0005 acompressor@x makeup 2", "acompressor@x=ratio=1", [8000, 8000, 8000, 8000, 16000, 16000, 16000, 16000]],
    ["0.0003 acompressor@x makeup 2", "acompressor@x=ratio=1", [8000, 8000, 8000, 8000, 16000, 16000, 16000, 16000]],
    ["0.0005 acompressor@other makeup 2", "acompressor@x=ratio=1", samples],
    ["0.0005 acompressor makeup 2", "acompressor@x=ratio=1,acompressor@y=ratio=1", [8000, 8000, 8000, 8000, 16000, 16000, 16000, 16000]],
    ["0.0005 acompressor@y makeup 2", "acompressor@x=ratio=1,acompressor@y=ratio=1", [8000, 8000, 8000, 8000, 16000, 16000, 16000, 16000]],
    ["0 acompressor@x makeup 2;0.00025 acompressor@x makeup invalid;0.0005 acompressor@x makeup 65;0.00075 acompressor@x makeup 1", "acompressor@x=ratio=1", [16000, 16000, 16000, 16000, 16000, 16000, 8000, 8000]],
    ["", "acompressor@x=ratio=1", samples],
    ["", "acompressor@x=ratio=1:makeup=2", Array<number>(8).fill(16000)]
  ] as const) {
    it(`acompressor scheduled makeup ${command || compressors} (${graph ? "graph" : "simple"})`, async () => {
      assert.deepEqual(await run(`${command ? `asendcmd=c='${command}',` : ""}${compressors}`, graph), expected);
    });
  }
}

async function run(filter: string, graph: boolean): Promise<number[]> {
  const input = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
  const volume = Volume.fromJSON({ "/in.raw": input });
  const chain = `asetnsamples=n=2:p=0,${filter}`;
  const output: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]), "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const pcm = Buffer.concat(output);
  return Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2));
}
