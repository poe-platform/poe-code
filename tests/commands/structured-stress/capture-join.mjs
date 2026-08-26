import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const version = spawnSync("/usr/bin/jq", ["--version"], { shell: false, timeout: 2000, maxBuffer: 65536 });
assert.ifError(version.error);
assert.equal(version.stdout.toString().trim(), "jq-1.7.1-apple");
const cases = [];
const add = (id, input, filter, extra = {}) => cases.push({ id, input, argv: ["-c", "--", filter], ...extra });
for (const [id, input] of Object.entries({ empty: "[]", singleton: '["a"]', pair: '["a","b"]', nulls: "[null,null]", mixed: '["a",null,0,-0,1.5,true,false,""]', unicode: '["😀","é","雪","\\u0000","\\n"]', object: '{"2":"b","1":"a","__proto__":"safe","constructor":"own","prototype":null}', emptyObject: "{}", nestedArray: '[["x"]]', nestedObject: '[{"x":1}]', nullInput: "null", stringInput: '"abc"' })) {
  for (const separator of ['"-"', 'null', 'false', '1', '[]', 'empty', '("-",":")']) add(`${id}:${separator}`, input, `join(${separator})`);
}
for (const [id, input, filter] of [
  ["separator-object", '["a","b"]', 'join({})'],
  ["separator-true", '["a","b"]', 'join(true)'],
  ["singleton-object-separator", '[true]', 'join({})'],
  ["empty-object-separator", '[]', 'join({})'],
  ["booleans", '[false,true]', 'join(":")'],
  ["all-null", '[null,null,null]', 'join("|")'],
  ["empty-strings", '["","",""]', 'join("|")'],
  ["input-bound-separator", '["sep","x","y"]', 'join(.[0])'],
  ["object-bound-separator", '{"sep":"-","value":"x"}', 'join(.sep)'],
  ["separator-iteration", '["a","b"]', 'join(.[])'],
  ["separator-duplicates", '["a","b"]', 'join(("-","-"))'],
  ["empty-separator-error", '[]', 'join(1/0)'],
  ["singleton-separator-error", '["x"]', 'join(1/0)'],
  ["separator-error-prefix", '["a","b"]', 'join(("-",1/0))'],
  ["empty-separator-error-prefix", '[]', 'join(("-",1/0))'],
  ["separator-type-prefix", '["a","b"]', 'join(("-",0,":"))'],
  ["outer-prefix-error", '["a",{}]', '"prefix",join("-")'],
  ["optional-error-prefix", '["a","b"]', '[join(("-",1/0))?]'],
  ["optional-type-prefix", '["a","b"]', '[join(("-",0,":"))?]'],
  ["first-lazy", '["a","b"]', 'first(join(("-",1/0)))'],
  ["first-empty-lazy", '[]', 'first(join(("-",1/0)))'],
  ["first-million-separators", '[]', 'first(join(range(1000000)))'],
  ["limit-separators", '["a","b"]', 'limit(2;join(("-",":",1/0)))'],
  ["limit-zero", 'null', 'limit(0;join(1/0))'],
  ["null-empty-lazy", 'null', '[join(empty)]'],
  ["null-error-order", 'null', 'join((1/0,"-"))'],
  ["nested-empty-lazy", '[{}]', '[join(empty)]'],
  ["multi-input-cartesian", '[["a","b"],["c","d"]]', '.[]|join(("-",":"))'],
  ["generator-with-filter", '["a","b"]', 'join((empty,"-",empty,":"))'],
  ["join-in-assignment", '{"a":["x","y"]}', '.a |= join(("-",1/0))'],
  ["join-computed-index", '[["a","b"],["c","d"]]', '.[(0,1)]|join("-")'],
  ["join-empty-last", '[]', 'last(join(empty))'],
  ["join-numeric-input", '42', 'join("-")'],
  ["join-bool-input", 'false', 'join("-")'],
  ["join-zero-arity", '[]', 'join'],
  ["join-two-arity", '[]', 'join("-";":")'],
]) add(id, input, filter);
for (const [id, input, virtual] of [["decimal-lexeme", "[1e2]", '"100"\n'], ["tiny-exponent", "[0.0000001]", '"1e-7"\n'], ["large-exponent", "[1e21]", '"1e+21"\n']]) add(id, input, 'join(",")', { policy: "documented-numeric-rendering", policyStdout: virtual, policyStatus: 0 });
for (const [id, input, argv] of [
  ["raw-output", '["a",null,true,2]', ["-r", 'join(":")']],
  ["join-output", '["a","b"]', ["-j", 'join(("-",":"))']],
  ["exit-empty-string", '[]', ["-e", 'join("-")']],
  ["exit-no-results", '[]', ["-e", 'join(empty)']],
  ["raw-slurp-composition", 'a\nb', ["-Rs", '[.]|join("-")']],
  ["json-slurp-composition", '"a"\n"b"', ["-sr", 'join("-")']],
]) cases.push({ id, input, argv });
for (const fixture of cases) {
  const result = spawnSync("/usr/bin/jq", fixture.argv, { input: fixture.input, shell: false, timeout: 2000, maxBuffer: 65536 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  Object.assign(fixture, { stdout: result.stdout.toString(), status: result.status, stderr: result.stderr.toString().slice(0, 4096) });
}
const document = { provenance: { executable: "/usr/bin/jq", version: "jq-1.7.1-apple", date: "2026-08-26", shell: false, timeout: 2000, maxBuffer: 65536 }, cases };
const path = "tests/commands/structured-stress/join-native.json";
const patch = `*** Begin Patch\n*** Add File: ${path}\n${JSON.stringify(document, null, 2).split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`;
const applied = spawnSync("apply_patch", [patch], { encoding: "utf8", shell: false, timeout: 2000, maxBuffer: 65536 });
assert.equal(applied.status, 0, applied.stderr);
console.log(`${cases.length} join captures; ${cases.filter(fixture => fixture.policy).length} documented numeric-rendering differences`);
