import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const schedule = "0.001 volume@v volume 2;\n0.003 volume@v volume 0;\n";
async function render(sender: string, graph = false) {
  const volume = Volume.fromJSON({ "/work/cmds.txt": schedule, "/work/my cmds.txt": schedule });
  volume.writeFileSync("/work/in.wav", encodeWav({ sampleRate: 8000,
    channels: [new Float64Array(32).fill(1000 / 32768)] }, { bitsPerSample: 16 }));
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const filter = `asetnsamples=n=8:p=0,${sender},volume@v=1`;
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]), "-f", "s16le", "pipe:1"],
    cwd: "/work", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, output: Buffer.concat(stdout), stderr };
}

for (const graph of [false, true]) {
  for (const source of ["f=cmds.txt", "filename=cmds.txt", "f=/work/cmds.txt", "filename=/work/cmds.txt", "f='my cmds.txt'", `c='${schedule}'`]) {
    it(`reads asendcmd ${source} graph=${graph}`, async () => {
      const result = await render(`asendcmd=${source}`, graph);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.output.length, 64);
      for (let i = 0; i < 32; i++) assert.equal(result.output.readInt16LE(i * 2), i < 8 ? 1000 : i < 24 ? 2000 : 0);
    });
  }
}
for (const source of ["f=absent.txt", "filename=absent.txt"]) {
  it(`returns 254 for ${source}`, async () => {
    const result = await render(`asendcmd=${source}`);
    assert.equal(result.exitCode, 254, result.stderr);
    assert.equal(result.output.length, 0);
  });
}
for (const source of ["f=cmds.txt:c=0 volume@v volume 0", "commands=0 volume@v volume 0:filename=absent.txt"]) {
  it(`returns 234 for conflicting sources ${source}`, async () => {
    const result = await render(`asendcmd=${source}`);
    assert.equal(result.exitCode, 234, result.stderr);
    assert.equal(result.output.length, 0);
  });
}
