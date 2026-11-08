import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertBinding, baselineNames, controlCases, functions, inventory, lifecycleCases, limitNames, publicCases, runtimeCases, semantics, sha256 } from "./contract.mjs";

const owned = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(owned, "scratch"), { recursive: true });
const scratch = realpathSync(mkdtempSync(join(owned, "scratch", "selfcheck-")));
const report = { kind: "FIXTURE_SELF_VALIDATION_NO_PRODUCT_IMPORT_BUILD_PACK_OR_CANDIDATE", node: process.version, date: new Date().toISOString(), counts: { semantics: semantics.length, public: publicCases.length, lifecycle: lifecycleCases.length, runtime: runtimeCases.length, strictTypeInputs: 5, futureControlClasses: controlCases.length }, steps: [] };
const json = (name, value) => writeFileSync(join(scratch, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
const fixtureFiles = Object.fromEntries(readdirSync(owned).filter(name => name !== "scratch").map(name => [name, sha256(readFileSync(join(owned, name)))]));
json("PRE.json", { node: { filename: realpathSync(process.execPath), sha256: sha256(readFileSync(process.execPath)) }, fixtureFiles, ...report });
function run(name, args, extra = {}) {
  json(`${name}.PRE.json`, { args, cwd: scratch, tool: sha256(readFileSync(process.execPath)), inputs: inventory(scratch), fixtures: fixtureFiles });
  const result = spawnSync(process.execPath, args, { cwd: scratch, env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: scratch, TMPDIR: scratch, HTML_FIXTURE_ROOT: scratch }, encoding: "utf8", timeout: 10_000, ...extra });
  const raw = { name, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
  report.steps.push(raw);
  json(`${name}.RAW.json`, raw);
  assert.equal(raw.error, undefined);
  assert.equal(raw.signal, null);
  return raw;
}
try {
  assert.equal(new Set(runtimeCases.map(([id]) => id)).size, runtimeCases.length);
  assert.equal(baselineNames.length, 73);
  assert.equal(new Set(baselineNames).size, 73);
  assert.equal(limitNames.length, 13);
  assert.equal(functions.length, 3);
  for (const filename of readdirSync(owned).filter(name => name.endsWith(".mjs"))) assert.equal(run(`syntax-${filename}`, ["--check", join(owned, filename)]).status, 0);
  const typescriptPath = resolve(owned, "../../../node_modules/typescript/lib/typescript.js");
  json("TYPESCRIPT-PRE.json", { filename: typescriptPath, sha256: sha256(readFileSync(typescriptPath)), purpose: "syntax only, no product declaration resolution" });
  const typescript = (await import(pathToFileURL(typescriptPath).href)).default;
  for (const filename of readdirSync(owned).filter(name => name.endsWith(".ts.data"))) {
    const source = readFileSync(join(owned, filename), "utf8").replaceAll("__HTML_OPTION__", "UnresolvedOptionNameForSyntaxOnly");
    const parsed = typescript.createSourceFile(filename.replace(/\.data$/, ""), source, typescript.ScriptTarget.Latest, true);
    assert.deepEqual(parsed.parseDiagnostics, [], filename);
  }
  for (const boundary of ["SOURCE_ARCHIVE", "FULL_PACK", "APPEND_TREE"]) assert.throws(() => assertBinding({ accepted: "before", appended: "new" }, { accepted: "before" }, boundary), error => error.message.includes(`BOUNDARY:${boundary}`));
  const admissible = join(scratch, "node_modules", "sentinel");
  mkdirSync(admissible, { recursive: true });
  cpSync(join(owned, "poison.mjs"), join(admissible, "poison.mjs"));
  cpSync(join(owned, "loader.mjs"), join(scratch, "loader.mjs"));
  const sentinel = run("qualified-poison", ["--experimental-loader", "./loader.mjs", join(admissible, "poison.mjs")]);
  assert.equal(sentinel.status, 1);
  assert.match(sentinel.stderr, /Error: HTML_POISON_SENTINEL_20260827/);
  assert.ok(!sentinel.stderr.includes("ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING"));
  const rejected = run("qualified-sourceguard", ["--experimental-loader", "./loader.mjs", "--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(join(owned, "poison.mjs")).href)})`]);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /BOUNDARY:SOURCE_FALLBACK/);
  assert.ok(!rejected.stderr.includes("Error: HTML_POISON_SENTINEL_20260827"));
  const target = join(scratch, "permission-target.txt"), permissionHome = join(scratch, "permission-consumer");
  mkdirSync(permissionHome);
  cpSync(join(owned, "permission.mjs"), join(permissionHome, "permission.mjs"));
  writeFileSync(target, "fixture-readable", { flag: "wx" });
  const positive = run("permission-positive", [join(permissionHome, "permission.mjs"), target]);
  assert.equal(positive.status, 0);
  assert.match(positive.stdout, /PERMISSION_CONTROL_READ:fixture-readable/);
  const negative = run("permission-negative", ["--experimental-permission", `--allow-fs-read=${permissionHome}`, join(permissionHome, "permission.mjs"), target]);
  assert.equal(negative.status, 17);
  assert.match(negative.stderr, /BOUNDARY:PERMISSION_DENIED:FileSystemRead/);
  report.result = "SELF_CHECKS_PASS_ONLY";
  json("RESULT.json", report);
  console.log(JSON.stringify({ directory: scratch, result: report.result, counts: report.counts }));
} catch (error) {
  json("FAILURE.json", { ...report, error: String(error), stack: error.stack });
  throw error;
}
