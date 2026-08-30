import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [root, destination] = process.argv.slice(2);
mkdirSync(destination);
const directory = mkdtempSync(join(dirname(root), "reporter-probe-"));
const native = "tests/commands/regex-execution/continuation/artifacts/native";
const current = JSON.parse(readFileSync(join(root, "package.json")));
const before = JSON.parse(readFileSync(join(root, "tests/plugins/qualified-current-release-native-data/before-02.json")));
const write = (path, bytes) => { const target = join(directory, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); };
write("package.json", JSON.stringify(current));
write("tests/canonical/helper.ts", "export const helper = 'helper-loaded';\n");
write("tests/canonical/control.test.ts", "import assert from 'node:assert/strict'; import test from 'node:test'; import { helper } from './helper.js'; test('canonical-test-and-helper', () => assert.equal(helper, 'helper-loaded'));\n");
const neighbors = [`${native}-neighbor/control.test.ts`, "tests/commands/regex-execution/continuation/artifacts/control.test.ts", "tests/commands/regex-execution/continuation/control.test.ts", "tests/other/artifacts/native/space 🙂.test.ts"];
for (const [index, path] of neighbors.entries()) write(path, `import test from 'node:test'; test('neighbor-${index}', () => {});\n`);
for (const path of [`${native}/arbitrary.test.ts`, `${native}/nested/space 🙂.test.ts`]) write(path, "throw new Error('NATIVE_DATA_MUST_NOT_EXECUTE');\n");
const inputs = [];
const collect = directoryPath => { for (const name of readdirSync(directoryPath, { withFileTypes: true })) { const target = join(directoryPath, name.name); if (name.isDirectory()) collect(target); else { const bytes = readFileSync(target); inputs.push({ path: target.slice(directory.length + 1), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }); } } };
collect(directory); writeFileSync(join(destination, "input-manifest.json"), JSON.stringify({ qualification: "Independent synthetic reconstruction of the unchanged candidate test's five-test/two-data discovery fixture; not a modified canonical fixture or rescoring", inputs }, null, 2) + "\n");
symlinkSync(join(root, "node_modules"), join(directory, "node_modules"), "dir");
const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
const run = (name, args, expected, positive) => {
  const result = spawnSync("npm", args, { cwd: directory, env, encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  writeFileSync(join(destination, `${name}.json`), JSON.stringify({ executable: "npm", args, cwd: directory, node: process.version, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }, null, 2) + "\n");
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, expected);
  if (positive) { assert.match(result.stdout, /canonical-test-and-helper/u); for (const index of neighbors.keys()) assert.match(result.stdout, new RegExp(`neighbor-${index}`, "u")); assert.doesNotMatch(result.stdout + result.stderr, /NATIVE_DATA_MUST_NOT_EXECUTE/u); }
  else assert.match(result.stdout + result.stderr, /NATIVE_DATA_MUST_NOT_EXECUTE/u);
  return result;
};
try {
  const automatic = run("unchanged-filtered-default", ["test"], 0, true);
  const tap = run("explicit-tap-filtered", ["test", "--", "--test-reporter=tap"], 0, true);
  assert.match(tap.stdout, /# tests 5\b/u); assert.match(tap.stdout, /# pass 5\b/u);
  write("package.json", JSON.stringify({ ...current, scripts: { ...current.scripts, test: before.before.testScript } }));
  const negative = run("explicit-tap-unfiltered", ["test", "--", "--test-reporter=tap"], 1, false);
  assert.match(negative.stdout, /# tests 7\b/u); assert.match(negative.stdout, /# fail 2\b/u);
  console.log(JSON.stringify({ node: process.version, unchangedDefaultIsTap: /# tests 5\b/u.test(automatic.stdout), explicitTapFiltered: { tests: 5, pass: 5, status: tap.status }, explicitTapUnfiltered: { tests: 7, fail: 2, status: negative.status }, originalCanonicalFixtureModified: false }));
} finally { rmSync(directory, { recursive: true, force: true }); }
