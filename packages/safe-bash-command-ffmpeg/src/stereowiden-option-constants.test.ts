import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, 72 stereo PCM16LE frames at 8 kHz.
const input = Buffer.alloc(288);
for (let i = 0; i < 72; i++) {
  input.writeInt16LE((i * 2341) % 24000 - 12000, i * 4);
  input.writeInt16LE((i * 1793 + 8000) % 30000 - 15000, i * 4 + 2);
}

for (const graph of [false, true]) {
  for (const [options, hash] of [
    ["feedback=min(0.5\\,0.6)", undefined],
    ["delay=max(1\\,10)", undefined],
    ["feedback=max", "9263ac1412a07fdec66b24cea6c530f671367e8c1db162a0f17889ee6c42f5ea"],
    ["delay=min", "205e332d41aa8f7d101c8267eae669090b3b45331395a775d3b9dc86934a185a"],
    ["delay=default", "9263ac1412a07fdec66b24cea6c530f671367e8c1db162a0f17889ee6c42f5ea"],
    ["delay=PI", "e4d5fe52a4dd00355347192f782403d64faf472428ef53d09303a74671fe15f7"],
    ["delay=E", "e2009e0d71659639bde5acb2f201d1de603420bd462d75b33f78476db0e603fa"],
    ["delay=PHI", "f03ce7cf3b42d91d4cc6f41e082b559a95a49b8d03ca5bfc6b22681cc81d107b"],
    ["feedback=0.9", "9263ac1412a07fdec66b24cea6c530f671367e8c1db162a0f17889ee6c42f5ea"],
    ["delay=1", "205e332d41aa8f7d101c8267eae669090b3b45331395a775d3b9dc86934a185a"],
    ["delay=3.141592653589793", "e4d5fe52a4dd00355347192f782403d64faf472428ef53d09303a74671fe15f7"],
    ["delay=2.718281828459045", "e2009e0d71659639bde5acb2f201d1de603420bd462d75b33f78476db0e603fa"],
    ["delay=1.618033988749895", "f03ce7cf3b42d91d4cc6f41e082b559a95a49b8d03ca5bfc6b22681cc81d107b"]
  ] as const) {
    it(`stereowiden=${options} matches native status and destination (${graph ? "graph" : "simple"})`, async () => {
      const { result, output, stderr } = await run(`stereowiden=${options}`, graph);
      assert.equal(result.exitCode, hash === undefined ? 234 : 0, stderr);
      if (hash === undefined) assert.equal(output.toString(), "KEEP");
      else {
        assert.equal(output.length, input.length);
        assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      }
    });
  }

  for (const [options, literal] of [
    ["min:max:min:max", "1:0.9:0:1"],
    ["delay=max:feedback=min:crossfeed=max:drymix=min", "100:0:0.8:0"],
    ["delay=1:delay=default:feedback=0:feedback=default:crossfeed=0:crossfeed=default:drymix=0:drymix=default", "20:0.3:0.3:0.8"],
    ["delay=min+1:feedback=max/2:crossfeed=default/2:drymix=E/E", "2:0.45:0.15:1"],
    ["enable=max(0\\,min(1\\,1))", "enable=1"]
  ]) {
    it(`stereowiden=${options} matches literal options (${graph ? "graph" : "simple"})`, async () => {
      const actual = await run(`stereowiden=${options}`, graph);
      const expected = await run(`stereowiden=${literal}`, graph);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      assert.deepEqual(actual.output, expected.output);
    });
  }

  for (const [expression, literal] of [["min", "0"], ["max", "0.9"], ["default", "0.3"], ["PI/10", "0.3141592653589793"], ["min(0.1,0.2)", "0.5"]]) {
    it(`stereowiden feedback command ${expression} matches native constants (${graph ? "graph" : "simple"})`, async () => {
      const actual = await run(`asendcmd=c='0 stereowiden feedback ${expression}',stereowiden=delay=1:feedback=0.5`, graph);
      const expected = await run(`stereowiden=delay=1:feedback=${literal}`, graph);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      assert.deepEqual(actual.output, expected.output);
    });
  }
}

async function run(filter: string, graph: boolean) {
  const volume = Volume.fromJSON({ "/in.raw": input, "/out": "KEEP" });
  let stderr = "";
  const chain = `asetnsamples=n=8:p=0,${filter}`;
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]), "-f", "s16le", "/out"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, output: volume.readFileSync("/out") as Buffer, stderr };
}
