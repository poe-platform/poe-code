import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";
import { parseFilterExpression } from "./filter-expression.js";

const constants = [["PI", Math.PI], ["E", Math.E], ["PHI", (1 + Math.sqrt(5)) / 2]] as const;

for (const [name, value] of constants) {
  it(`resolves built-in ${name} after caller-defined variables`, () => {
    assert.equal(parseFilterExpression(`1/${name}`, "deesser", {}), 1 / value);
    assert.equal(parseFilterExpression(name, "deesser", { [name]: 0 }), 0);
    assert.throws(() => parseFilterExpression(name.toLowerCase(), "deesser", {}));
  });

  for (const graph of [false, true]) {
    it(`deesser ${name} timeline matches native PCM (graph=${graph})`, async () => {
      // FFmpeg 7.0.2 on the same four-sample PCM16 WAV.
      assert.equal(await run(`deesser=i=1:enable=${name}`, graph), "380499e93a08b2ec");
      assert.equal(await run(`deesser=i=1:enable=${name}-${name}`, graph), "e02eb0b9c05d80c1");
    });

    it(`deesser ${name} numeric options match literals (graph=${graph})`, async () => {
      for (const option of ["i", "m", "f", "s", "threads", "extra_hw_frames"]) {
        const actual = await run(`deesser=i=1:${option}=1/${name}`, graph);
        const expected = await run(`deesser=i=1:${option}=${1 / value}`, graph);
        assert.equal(actual, expected, option);
        if (name === "PI" && option === "i") assert.equal(actual, "582e18ba985ce7c1");
      }
      assert.equal(await run(`deesser=1/${name}:0.5:0.5:o`, graph), await run(`deesser=i=${1 / value}`, graph));
    });
  }
}

it("keeps scientific notation and E suffixes distinct from Euler's constant", () => {
  assert.equal(parseFilterExpression("1E-3", "deesser", {}), 0.001);
  assert.equal(parseFilterExpression("1E", "deesser", {}), 1e18);
});

async function run(filter: string, graph: boolean): Promise<string> {
  const fs = new Volume();
  fs.writeFileSync("/in.wav", encodeWav({
    sampleRate: 8000,
    channels: [Float64Array.from([12000, -18000, 24000, -16000], value => value / 32768)]
  }, { bitsPerSample: 16 }));
  const chunks: Uint8Array[] = [];
  let stderr = "";
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
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, `${filter}: ${stderr}`);
  return Buffer.concat(chunks).toString("hex");
}
