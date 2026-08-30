import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { type ByteSource } from "../../../../src/contracts/index.js";
import { run, shell } from "../helpers.js";

interface Fixture { id: string; args: string[]; input: string; sealedRecipe?: string }
interface NativeRecord { id: string; args: string[]; stdinHex: string; status: number; stdoutHex: string; stderrHex: string }
const load = (name: string): Buffer => readFileSync(new URL(name, import.meta.url));
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const index = JSON.parse(load("./native-index.json").toString()) as { path: string; sha256: string };
const capturedBytes = load(`./${index.path}`);
const captured = JSON.parse(capturedBytes.toString()) as {
  binary: { sha256: string }; casesSha256: string; originalNativeSha256: string; originalProvenanceSha256: string; observations: NativeRecord[];
};
const fixtures = JSON.parse(load("./native-cases.json").toString()) as Fixture[];

test("padding native capture is authenticated and original N01/N03 bytes remain sealed", () => {
  assert.equal(hash(capturedBytes), index.sha256);
  assert.equal(hash(load("./native-cases.json")), captured.casesSha256);
  assert.equal(captured.binary.sha256, "a599976edf85eaa3222ac745309596023b5e63283a8b8ee3c3834d741214dd88");
  const oldBytes = load("../../column-stress/native-observations.json");
  assert.equal(hash(oldBytes), captured.originalNativeSha256);
  assert.equal(hash(load("../../column-stress/provenance.json")), captured.originalProvenanceSha256);
  const old = JSON.parse(oldBytes.toString()) as { observations: { profile: string; recipe: string; argv: string[]; stdinHex: string; stdoutHex: string; stderrHex: string; status: number }[] };
  const recipes = JSON.parse(load("../../column-stress/recipes.json").toString()) as { nativeRecipes: { id: string; variants: { argv: string[]; stdinUtf8: string }[] }[] };
  assert.equal(fixtures.length, 14);
  assert.equal(captured.observations.length, 14);
  for (const id of ["N01", "N03"]) {
    const original = old.observations.find(record => record.profile === "util-linux-2.41.2-darwin" && record.recipe === id)!;
    const record = captured.observations.find(record => record.id === id)!;
    const recipe = recipes.nativeRecipes.find(recipe => recipe.id === id)!.variants[0]!;
    assert.deepEqual(record.args, recipe.argv);
    assert.deepEqual(record.args, original.argv);
    assert.equal(record.stdinHex, Buffer.from(recipe.stdinUtf8).toString("hex"));
    assert.equal(record.stdinHex, original.stdinHex);
    assert.equal(record.stdoutHex, original.stdoutHex);
    assert.equal(record.stderrHex, original.stderrHex);
    assert.equal(record.status, original.status);
  }
});

for (const fixture of fixtures) test(`new profile pinned util-linux exact: ${fixture.id}`, async () => {
  const expected = captured.observations.find(record => record.id === fixture.id)!;
  assert.deepEqual(fixture.args, expected.args);
  assert.equal(Buffer.from(fixture.input).toString("hex"), expected.stdinHex);
  const result = await run(fixture.args, fixture.input);
  assert.equal(result.exitCode, expected.status);
  assert.equal(result.stdoutBytes.toString("hex"), expected.stdoutHex);
  assert.equal(Buffer.from(result.stderr).toString("hex"), expected.stderrHex);
});

test("Memory VFS operands share padding widths without sorting or inventing cells", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/first", Buffer.from(" z\t9  \n"));
  await fs.writeFile("/middle", Buffer.from("alpha  1 tail\n"));
  await fs.writeFile("/last", Buffer.from(" b\t22\n"));
  const result = await run(["-t", "/first", "/middle", "/last"], "", { limits: { maxRows: 3, maxCells: 7, maxFields: 3 } }, { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "z      9   \nalpha  1   tail\nb      22  \n");
});

test("actual shell pipeline and VFS redirection retain trailing bytes", async () => {
  const instance = shell();
  try {
    const result = await instance.exec("printf 'a,b:c\\nd::e,\\n' | column -t -s ',:' > /padded; cat /padded | cat");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "a  b  c  \nd     e  \n");
    assert.equal((await instance.exec("cat /padded")).stdout, result.stdout);
  } finally { await instance.dispose(); }
});

test("borrowed split multibyte inputs retain exact padded output", async () => {
  const original = Buffer.from("界:a:b\nx\n");
  for (const width of [1, 2, 5]) {
    const buffer = Buffer.alloc(width);
    const stdin: ByteSource = (async function* () {
      try {
        for (let offset = 0; offset < original.length; offset += width) {
          const length = Math.min(width, original.length - offset);
          original.copy(buffer, 0, offset, offset + length);
          yield buffer.subarray(0, length);
          buffer.fill(0x78);
        }
      } finally { buffer.fill(0x79); }
    })();
    const result = await run(["-t", "-s:", "-o界·"], "", {}, { stdin });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "界界·a界·b\nx 界· 界·\n");
  }
});

test("strict decoding, control rejection and unsupported advanced options remain", async () => {
  for (const input of [Buffer.from([0xff]), Buffer.from("a\x1b:b\n"), Buffer.from("a\u200d:b\n")]) {
    const result = await run(["-t", "-s:"], input);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
  }
  for (const args of [["--json"], ["--tree", "1"], ["-c0"], ["-tx"]]) assert.equal((await run(args, "a b\n")).exitCode, 1);
});

test("new profile preserves exact row/cell/argument/width limits", async () => {
  const input = "a:b:c\nd\n";
  assert.equal((await run(["-t", "-s:"], input, { limits: { maxRows: 2, maxCells: 4, maxFields: 3, maxWidth: 1, maxInputBytes: 8, maxArgumentBytes: 5 } })).exitCode, 0);
  for (const limits of [{ maxRows: 1 }, { maxCells: 3 }, { maxFields: 2 }, { maxInputBytes: 7 }, { maxArgumentBytes: 4 }]) {
    const result = await run(["-t", "-s:"], input, { limits });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
  }
  assert.equal((await run(["-t", "-s:"], "界:a\nx\n", { limits: { maxWidth: 1 } })).exitCode, 1);
});
