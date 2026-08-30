import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { baseline, compile, createCopy, diagnostics, native, owned, root, run } from "./helpers.js";

test("native-data manifest records complete classification and six exact raw payload hashes", () => {
  const manifest = baseline();
  assert.equal(manifest.counts.files, 72);
  assert.equal(manifest.counts.rawPayloads, 22);
  assert.equal(manifest.counts.generatedCaches, 50);
  assert.equal(manifest.counts.maintainedSourcesOrHelpers, 0);
  for (const entry of manifest.files) {
    assert.match(entry.sha256, /^[a-f\d]{64}$/u);
    assert.ok(entry.path.startsWith(native + "/"));
    if (entry.classification === "raw-native-glob-payload") assert.equal(entry.bytes, 4);
  }
  const rawTypeScript = manifest.files.filter(entry => entry.classification === "raw-native-glob-payload" && entry.path.endsWith(".ts"));
  assert.deepEqual(rawTypeScript.map(entry => entry.path.slice(native.length + 1)).sort(), ["dialect-bFUsLx/alpha.ts", "dialect-bFUsLx/beta.ts", "dialect-uhGVu3/ab.ts", "dialect-uhGVu3/🙂.ts", "dialect-xj7h8F/a.ts", "dialect-xj7h8F/d.ts"]);
  assert.ok(rawTypeScript.every(entry => entry.sha256 === "74a02f560cc1d8e023280b5f08a1ee7266e4bec6cea61ca457dc1a758d080fc8"));
});

test("root compiler configuration differs only by the exact data exclusion", () => {
  const before = JSON.parse(readFileSync(join(owned, "before-02.json"), "utf8")) as { before: { config: { exclude: string[] } } };
  const current = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8")) as { exclude: string[] };
  assert.deepEqual(current, { ...before.before.config, exclude: [...before.before.config.exclude, native] });
});

test("copied root config includes canonical source, test, helper and artifact neighbors", () => {
  const copy = createCopy();
  try {
    const eligible = ["src/native-data-control.ts", "tests/canonical/control.test.ts", "tests/canonical/helper.ts", `${native}-neighbor/control.ts`, "tests/commands/regex-execution/continuation/artifacts/helper.ts", "tests/other/artifacts/native/helper.ts"];
    for (const path of eligible) copy.write(path, "export const included: boolean = true;\n");
    copy.write(`${native}/nested/payload.ts`, "hit\n");
    copy.write(`${native}/arbitrary.test.ts`, "hit\n");
    const positive = compile(copy.directory);
    assert.equal(positive.status, 0, positive.stdout + positive.stderr);
    const list = compile(copy.directory, true);
    assert.equal(list.status, 0, list.stdout + list.stderr);
    const program = list.stdout.trim().split("\n").map(path => relative(copy.directory, path));
    for (const path of eligible) assert.ok(program.includes(path), path);
    assert.ok(!program.some(path => path.startsWith(native + "/")));
  } finally { copy.dispose(); }
});

test("identical undefined symbols outside the exact subtree remain real TS2304 errors", () => {
  const copy = createCopy();
  try {
    const eligible = ["src/native-data-control.ts", "tests/canonical/control.test.ts", "tests/canonical/helper.ts", `${native}-neighbor/control.ts`, "tests/commands/regex-execution/continuation/artifacts/helper.ts", "tests/other/artifacts/native/helper.ts"];
    for (const path of [...eligible, `${native}/nested/payload.ts`]) copy.write(path, "hit\n");
    const negative = compile(copy.directory);
    assert.equal(negative.status, 2);
    assert.deepEqual(diagnostics(negative.stdout).sort(), eligible.map(path => `${path}(1,1): error TS2304: Cannot find name 'hit'.`).sort());
  } finally { copy.dispose(); }
});

test("actual npm script excludes future native test data without excluding neighboring tests/helpers", () => {
  const copy = createCopy();
  try {
    copy.write("tests/canonical/helper.ts", "export const helper = 'helper-loaded';\n");
    copy.write("tests/canonical/control.test.ts", "import assert from 'node:assert/strict'; import test from 'node:test'; import { helper } from './helper.js'; test('canonical-test-and-helper', () => assert.equal(helper, 'helper-loaded'));\n");
    const neighbors = [`${native}-neighbor/control.test.ts`, "tests/commands/regex-execution/continuation/artifacts/control.test.ts", "tests/commands/regex-execution/continuation/control.test.ts", "tests/other/artifacts/native/space 🙂.test.ts"];
    for (const [index, path] of neighbors.entries()) copy.write(path, `import test from 'node:test'; test('neighbor-${index}', () => {});\n`);
    const data = [`${native}/arbitrary.test.ts`, `${native}/nested/space 🙂.test.ts`];
    for (const path of data) copy.write(path, "throw new Error('NATIVE_DATA_MUST_NOT_EXECUTE');\n");
    const current = JSON.parse(readFileSync(join(copy.directory, "package.json"), "utf8")) as { scripts: { test: string } };
    const discovery = globSync("tests/**/*.test.ts", { cwd: copy.directory }).sort();
    assert.equal(discovery.length, 7);
    assert.ok(data.every(path => discovery.includes(path)));
    const result = run(copy.directory, "npm", ["test"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /# tests 5\b/u);
    assert.match(result.stdout, /# pass 5\b/u);
    assert.match(result.stdout, /canonical-test-and-helper/u);
    for (const index of neighbors.keys()) assert.match(result.stdout, new RegExp(`neighbor-${index}`, "u"));
    assert.doesNotMatch(result.stdout + result.stderr, /NATIVE_DATA_MUST_NOT_EXECUTE/u);
    const original = JSON.parse(readFileSync(join(owned, "before-02.json"), "utf8")) as { before: { testScript: string } };
    copy.write("package.json", JSON.stringify({ ...current, scripts: { ...current.scripts, test: original.before.testScript } }));
    const unfiltered = run(copy.directory, "npm", ["test"]);
    assert.equal(unfiltered.status, 1);
    assert.match(unfiltered.stdout + unfiltered.stderr, /NATIVE_DATA_MUST_NOT_EXECUTE/u);
    assert.match(unfiltered.stdout, /# tests 7\b/u);
    assert.match(unfiltered.stdout, /# fail 2\b/u);
  } finally { copy.dispose(); }
});
