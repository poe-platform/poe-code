import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runtimeSetup } from "./helpers.js";

interface FrozenCase {
  id: string;
  productScript: string;
  expectation: { stdout: string };
  env?: Record<string, string>;
  fixtures?: string[];
}

const frozen: { scripts: FrozenCase[] } = await import(new URL("../../getopts-independent-20260827/stage2/corpus.mjs", import.meta.url).href);

for (const item of frozen.scripts.filter(item => ["N01", "N02", "N03", "N06", "N07", "N08", "N09", "N10", "N11", "N16"].includes(item.id))) {
  test(`frozen nonfailure stdout profile ${item.id}, not native diagnostic byte parity`, async () => {
    const { shell, fs } = runtimeSetup();
    await fs.mkdir("/fixtures");
    for (const file of item.fixtures ?? []) await fs.writeFile(`/${file}`, readFileSync(new URL(`../../getopts-independent-20260827/stage2/${file}`, import.meta.url)));
    const result = await shell.exec(item.productScript, item.env ? { env: item.env } : {});
    assert.equal(result.stdout, item.expectation.stdout);
    assert.equal(result.exitCode, 0, result.stderr);
  });
}

test("D01 exact temporary prefix restoration deliberately differs from native N04", async () => {
  const { shell } = runtimeSetup();
  const result = await shell.exec('getopts abc opt -abc; say "$opt"; OPTIND=1 getopts abc opt -abc; say "$opt"; getopts abc opt -abc; say "$opt"; getopts abc opt -abc; say "$opt"');
  assert.equal(result.stdout, "a\na\nb\nc\n");
  assert.equal(result.stderr, "");
});

test("N05 correction retains function-entry snapshot and repeated local reset", async () => {
  const { shell } = runtimeSetup();
  const item = frozen.scripts.find(item => item.id === "N05")!;
  const expected = item.expectation.stdout.replace("repeated-local|0|b|1|", "repeated-local|0|a|1|");
  assert.equal((await shell.exec(item.productScript)).stdout, expected);
});

for (const source of [
  'OPTIND=1', 'OPTIND=$OPTIND', 'export OPTIND=1', 'readonly OPTIND=1',
  'read OPTIND <<< 1', 'read -r OPTIND <<< 1', 'for OPTIND in 1; do :; done',
  '((OPTIND=1))', ': $((OPTIND=1))', 'unset OPTIND; : "${OPTIND:=1}"',
]) {
  test(`successful origin synchronizes after store: ${source}`, async () => {
    const { shell } = runtimeSetup();
    const result = await shell.exec(`getopts abc opt -abc; ${source}; getopts abc opt -abc; say "$opt:$OPTIND"`);
    assert.equal(result.stdout, "a:1\n");
    if (source.startsWith("readonly")) assert.match(result.stderr, /OPTIND: readonly variable/u);
    else assert.equal(result.stderr, "");
  });
}

test("successful EOF read store resets even though read returns one", async () => {
  const { shell, fs } = runtimeSetup();
  await fs.writeFile("/input", new TextEncoder().encode("1"));
  const result = await shell.exec('getopts abc opt -abc; getopts abc opt -abc; read OPTIND < /input; say "$?"; getopts abc opt -abc; say "$opt"');
  assert.equal(result.stdout, "1\na\n");
});

test("scalar integer binding is fresh, lost by unset/local, and restored afterward", async () => {
  const { shell } = runtimeSetup();
  const result = await shell.exec('OPTIND="1+1"; say "$OPTIND"; unset OPTIND; OPTIND="1+1"; say "$OPTIND"; getopts ab opt -a -b; say "$opt:$OPTIND"; bash -c \'OPTIND="1+1"; f() { local OPTIND="1+1"; say "$OPTIND"; }; f; say "$OPTIND"\'');
  assert.equal(result.stdout, "2\n1+1\na:2\n1+1\n2\n");
});

for (const [value, expected] of [["0", "a"], ["-1", "a"], ["0x2", "b"], ["4294967297", "a"], ["99", "?"]] as const) {
  test(`integer index profile ${value}`, async () => {
    const { shell } = runtimeSetup();
    assert.equal((await shell.exec(`OPTIND=${value}; getopts ab opt -a -b; say "$opt"`)).stdout, `${expected}\n`);
  });
}

test("invalid octal assignment is fatal without inventing a general declare builtin", async () => {
  const { shell } = runtimeSetup();
  const result = await shell.exec('OPTIND=08; say unreachable');
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, 'shell: line 1: 08: arithmetic syntax error: operand expected (error token is "8")\n');
  assert.equal((await shell.exec("type -t declare")).exitCode, 1);
});

test("fresh defaults preserve inherited export bits while clones do not initialize", async () => {
  const { shell } = runtimeSetup();
  assert.equal((await shell.exec('say "$OPTIND:$OPTERR"; envget OPTIND OPTERR; getopts a opt -a')).stdout, "1:1\n<unset>|<unset>");
  assert.equal((await shell.exec('say "$OPTIND:$OPTERR"; envget OPTIND OPTERR', { env: { OPTIND: "9", OPTERR: "0" } })).stdout, "1:1\n1|1");
  assert.equal((await shell.exec('OPTIND=9; OPTERR=0; export OPTIND OPTERR; bash -c \'say "$OPTIND:$OPTERR"; envget OPTIND OPTERR\'')).stdout, "1:1\n1|1");
  assert.equal((await shell.exec('getopts a opt -a; say "$OPTIND"')).stdout, "2\n");
  assert.equal((await shell.exec('say "$OPTIND"')).stdout, "1\n");
});

test("registry collision, functions and command bypass retain regular builtin discovery", async () => {
  const { shell, commands } = runtimeSetup();
  await shell.exec(":");
  commands.register({ name: "getopts", execute() { throw new Error("registry must not execute"); } });
  const names = commands.list().map(command => command.name);
  const result = await shell.exec('type -t getopts; getopts a opt -a; say "$opt"; getopts() { say shadow; }; getopts; OPTIND=1; command getopts a opt -a; say "$opt"');
  assert.equal(result.stdout, "builtin\na\nshadow\na\n");
  assert.deepEqual(commands.list().map(command => command.name), names);
});

test("groups/source/eval share state while pipelines, substitutions and subshells clone", async () => {
  const { shell, fs } = runtimeSetup();
  await fs.writeFile("/source", new TextEncoder().encode('getopts abcdef opt -abcdef; say "$opt"'));
  const result = await shell.exec('getopts abcdef opt -abcdef; (getopts abcdef opt -abcdef; say "$opt"); getopts abcdef opt -abcdef | pass; say "$(getopts abcdef opt -abcdef; say "$opt")"; { getopts abcdef opt -abcdef; say "$opt"; }; . /source; eval \'getopts abcdef opt -abcdef; say "$opt"\'; say "$opt"');
  assert.equal(result.stdout, "b\nb\nb\nc\nd\nd\n");
});

test("prefix function redirection scratch and substitution installation isolate metadata", async () => {
  const { shell } = runtimeSetup();
  const result = await shell.exec('getopts abc opt -abc; f() { getopts abc opt -abc; say "$opt"; }; OPTIND=1 f <<< "$(getopts abc opt -abc; say "$opt")"; getopts abc opt -abc; say "$opt"');
  assert.equal(result.stdout, "a\nb\n");
});
