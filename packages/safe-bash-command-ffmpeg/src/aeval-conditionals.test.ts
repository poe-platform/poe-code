import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";
import { parseFilterExpression } from "./filter-expression.js";

it("does not read samples in unselected conditional branches", () => {
  for (const expression of ["if(0,val(0),0.25)", "ifnot(1,val(0),0.25)", "if(1,0.25,if(1,val(0)))"]) {
    assert.equal(parseFilterExpression(expression, "aeval", {}, () => {
      assert.fail("unselected branch read a sample");
    }), 0.25);
  }
});

// Native FFmpeg 7.0.2 PCM16 results for four stereo input frames at 8 kHz.
for (const [expression, expected] of [
  ["if(n,1/n,0)", [0, 32767, 16384, 10923]],
  ["ifnot(n,0,1/n)", [0, 32767, 16384, 10923]],
  ["if(n,0.25)", [0, 8192, 8192, 8192]],
  ["if(n,0.25,0)", [0, 8192, 8192, 8192]],
  ["ifnot(n,0.25)", [8192, 0, 0, 0]],
  ["if(n,ifnot(n,1/0,0.25),0)", [0, 8192, 8192, 8192]],
  ["if(n,sin(0/n),0)", [0, 0, 0, 0]],
  ["if(n,0.25,if(1,0,pow(0,-1)))", [0, 8192, 8192, 8192]]
] as const) {
  for (const complex of [false, true]) {
    it(`evaluates only the selected aeval branch (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const { result, fs, stderr } = await run(expression, complex);
      assert.equal(result.exitCode, 0, stderr);
      const output = fs.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, expected.length * 2);
      assert.deepEqual(expected.map((_, i) => output.readInt16LE(i * 2)), expected);
    });
  }
}

for (const expression of ["if(n)", "if(n,0,1,2)", "if(n,)", "if(n,0,)", "if(0,missing(1),0)", "if(0,unknown,0)", "if(0,1+,0)"]) {
  it(`validates skipped aeval branch syntax without overwriting output: ${expression}`, async () => {
    const { result, fs } = await run(expression);
    assert.equal(result.exitCode, 1);
    assert.equal(fs.readFileSync("/out.raw", "utf8"), "keep");
  });
}

async function run(expression: string, complex = false) {
  const fs = Volume.fromJSON({ "/out.raw": "keep" });
  const input = Buffer.alloc(16);
  [110, -550, 220, -660, 330, -770, 440, -880].forEach((sample, i) => input.writeInt16LE(sample, i * 2));
  fs.writeFileSync("/grid.raw", input);
  let stderr = "";
  const filter = `aeval=${expression.split(",").join("\\,")}`;
  const filters = complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/grid.raw", ...filters, "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, fs, stderr };
}
