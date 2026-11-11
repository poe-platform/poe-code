import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(options: string, graph = false, channels = 2) {
  const input = Buffer.alloc(channels === 1 ? 16 : 256);
  for (let i = 0; i < input.length / 2; i++) input.writeInt16LE(i % channels ? 2000 : 8000, i * 2);
  const fs = Volume.fromJSON({ "/in.raw": input, "/out.raw": "keep" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-f", "s16le", "-ar", "8000", "-ac", String(channels), "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]acompressor=${options}[out]`, "-map", "[out]"] : ["-af", `acompressor=${options}`]),
      "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, output: fs.readFileSync("/out.raw") as Buffer, stderr };
}

for (const graph of [false, true]) {
  for (const [key, lower, upper] of [["mode", "downward", "upward"], ["link", "average", "maximum"], ["detection", "peak", "rms"]]) {
    it(`acompressor ${key} evaluates bounded enum expressions (${graph ? "graph" : "simple"})`, async () => {
      const low = await run(`${key}=${lower}`, graph);
      const high = await run(`${key}=${upper}`, graph);
      assert.equal(low.exitCode, 0, low.stderr);
      assert.equal(high.exitCode, 0, high.stderr);
      assert.notDeepEqual(low.output, high.output);
      for (const [expression, expected] of [
        ["0", low.output], ["1-1", low.output], ["0.5", low.output], [`${upper}-1`, low.output],
        ["1", high.output], ["1/1", high.output], ["0.5001", high.output], [`${lower}+1`, high.output]
      ] as const) {
        const result = await run(`${key}=${expression}`, graph);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.deepEqual(result.output, expected, `${key}=${expression}`);
      }
      for (const expression of ["-0.1", "1.1", "1+1", "0/0", "1/0", "bad", ""]) {
        const result = await run(`${key}=${expression}`, graph);
        assert.notEqual(result.exitCode, 0, `${key}=${expression}`);
        assert.equal(result.output.toString(), "keep");
      }
    });
  }
}

it("acompressor expressions match the native mono PCM reference", async () => {
  for (const options of ["mode=1-1", "link=1-1", "detection=1/1"]) {
    const result = await run(options, false, 1);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(Array.from({ length: 8 }, (_, i) => result.output.readInt16LE(i * 2)),
      [8000, 8000, 8000, 7999, 7970, 7916, 7850, 7779]);
  }
});
