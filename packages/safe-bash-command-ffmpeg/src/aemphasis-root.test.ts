import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";
import { parseFilterExpression } from "./filter-expression.js";

// Native FFmpeg 7.0.2 PCM hashes for the same 32-sample ramp.
for (const [expression, digest] of [
  [String.raw`root(ld(0)-2\,3)`, "0a06f1ae7c7c6c8767c67ba3fdf55ea1acb82841c5be9aa8bb1d7d3afdad46ba"],
  [String.raw`root(ld(0)*ld(0)-9\,4)`, "1542c32965a4f14a54c9b1ce852758449ccde3a663d873dccbeb65b79601ed1b"],
  ["2", "0a06f1ae7c7c6c8767c67ba3fdf55ea1acb82841c5be9aa8bb1d7d3afdad46ba"],
  ["3", "1542c32965a4f14a54c9b1ce852758449ccde3a663d873dccbeb65b79601ed1b"],
  ["ld(0)+2", "0a06f1ae7c7c6c8767c67ba3fdf55ea1acb82841c5be9aa8bb1d7d3afdad46ba"]
]) {
  for (const complex of [false, true]) {
    it(`matches native aemphasis root gain ${expression} (${complex ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(64);
      for (let i = 0; i < 32; i++) input.writeInt16LE(i * 300 - 4000, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input });
      const chunks: Buffer[] = [];
      let stderr = "";
      const filter = `aemphasis=level_in=${expression}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const output = Buffer.concat(chunks);
      assert.equal(output.length, 64);
      assert.equal(createHash("sha256").update(output).digest("hex"), digest);
    });
  }
}

for (const [expression, expected] of [
  ["root(ld(0)-2,3)+ld(0)", 9],
  ["root(2-ld(0),3)", 2],
  ["root(ld(0),3)", 0],
  ["root(ld(0)-3,3)", 3],
  ["root(ld(0)-2,st(0,3))+ld(0)", 9],
  ["if(0,root(st(1,1),3),2)+ld(1)", 2],
  ["root(st(1,ld(1)+1);ld(0)-3,3);ld(1)", 1]
] as const) {
  it(`evaluates root register semantics: ${expression}`, () => {
    const registers = new Float64Array(10);
    registers[0] = 7;
    assert.equal(parseFilterExpression(expression, "aemphasis", {}, undefined, registers), expected);
    assert.equal(registers[0], 7);
  });
}

for (const expression of ["root(ld(0))", "root(ld(0),3,4)", "root(missing,3)"]) {
  it(`rejects invalid root expression: ${expression}`, () => {
    assert.throws(() => parseFilterExpression(expression, "aemphasis", {}, undefined, new Float64Array(10)));
  });
}

it("bounds nested root searches and restores the search register on failure", () => {
  const registers = new Float64Array(10);
  registers[0] = 7;
  assert.throws(() => parseFilterExpression("root(root(1,3),3)", "aemphasis", {}, undefined, registers),
    /root evaluation limit/);
  assert.equal(registers[0], 7);
});
