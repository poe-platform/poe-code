import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const reference = JSON.parse(gunzipSync(Buffer.from(fs.readFileSync(path.join(own, "focused-01.json.gz.base64"), "utf8"), "base64")));
assert.equal(reference.completed, true);
const plan = JSON.parse(fs.readFileSync(path.join(own, "controls-plan.json"), "utf8"));
const supplementOnly = process.argv[3] === "supplement";
const output = path.join(own, `${process.argv[2] ?? "controls-01"}.json.gz.base64`);
assert.equal(fs.existsSync(output), false);
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "stage2-fd1-controls-")));
const root = path.join(temporary, "source");
const tooling = path.join(temporary, "node_modules");
const result = { capturedAt: new Date().toISOString(), candidate: reference.candidate, archiveSha256: reference.archiveSha256,
  temporary, plan, records: [], mutations: [], harness: Object.fromEntries(["controls.mjs", "controls-plan.json", "guard.mjs", "supplement.mjs"].map(name => [name, fs.readFileSync(path.join(own, name)).toString("base64")])) };
const inventory = directory => {
  const entries = {};
  const walk = folder => {
    for (const name of fs.readdirSync(folder).sort()) {
      const filename = path.join(folder, name);
      const stat = fs.lstatSync(filename);
      assert.equal(stat.isSymbolicLink(), false);
      if (stat.isDirectory()) walk(filename);
      else { assert.ok(stat.isFile()); assert.notEqual(name, "AGENTS.md"); entries[filename] = hash(fs.readFileSync(filename)); }
    }
  };
  walk(directory);
  return entries;
};
const environment = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: temporary, TMPDIR: temporary, LANG: "en_US.UTF-8", TSX_DISABLE_CACHE: "1" };
function execute(label, args, extra = {}) {
  const hashes = { ...inventory(root), ...inventory(tooling) };
  hashes[path.join(temporary, "guard.mjs")] = hash(fs.readFileSync(path.join(temporary, "guard.mjs")));
  const logs = path.join(temporary, `${label}-loads`);
  fs.mkdirSync(logs);
  const manifest = path.join(temporary, `${label}-manifest.json`);
  fs.writeFileSync(manifest, JSON.stringify({ hashes, logs }));
  extra.before?.();
  const child = spawnSync(process.execPath, args, { cwd: root, env: { ...environment,
    NODE_OPTIONS: `--import=${path.join(temporary, "guard.mjs")}`, STAGE2_GUARD_MANIFEST: manifest,
    STAGE2_PRODUCT_URL: pathToFileURL(path.join(root, "src/index.ts")).href }, timeout: 15000, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  const record = { label, args, status: child.status, signal: child.signal, error: child.error?.message, stdout: child.stdout, stderr: child.stderr,
    loads: fs.readdirSync(logs).flatMap(name => fs.readFileSync(path.join(logs, name), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line))) };
  result.records.push(record);
  console.log(JSON.stringify({ label, status: child.status, signal: child.signal }));
  assert.equal(child.error, undefined, label);
  assert.equal(child.signal, null, label);
  for (const load of record.loads) assert.equal(load.sha256, hashes[load.filename]);
  extra.after?.();
  assert.deepEqual({ ...inventory(root), ...inventory(tooling) }, Object.fromEntries(Object.entries(hashes).filter(([name]) => name !== path.join(temporary, "guard.mjs"))));
  return record;
}
const runtimeArgs = (pattern, fixture = "cohort.mjs") => ["--unhandled-rejections=strict", "--import", pathToFileURL(path.join(tooling, "tsx/dist/loader.mjs")).href,
  "--test", "--test-concurrency=1", "--test-name-pattern", pattern, `fixtures/${fixture}`];
try {
  fs.mkdirSync(root);
  const archive = Buffer.from(reference.archiveBase64, "base64");
  assert.equal(hash(archive), reference.archiveSha256);
  const extract = spawnSync("tar", ["-xz", "-C", root], { input: archive });
  assert.equal(extract.status, 0);
  for (const [name, tool] of Object.entries(reference.tools)) {
    const input = path.join(repository, "node_modules", name);
    for (const [filename, entry] of Object.entries(tool.files)) assert.equal(hash(fs.readFileSync(path.join(input, filename))), entry.sha256);
    const before = inventory(input);
    fs.mkdirSync(path.dirname(path.join(tooling, name)), { recursive: true });
    fs.cpSync(input, path.join(tooling, name), { recursive: true });
    assert.deepEqual(inventory(input), before);
  }
  fs.copyFileSync(path.join(own, "guard.mjs"), path.join(temporary, "guard.mjs"));
  fs.mkdirSync(path.join(root, "fixtures"));
  fs.writeFileSync(path.join(root, "fixtures/cohort.mjs"), reference.effectiveCohort);
  fs.copyFileSync(path.join(own, "supplement.mjs"), path.join(root, "fixtures/supplement.mjs"));
  const sourceBefore = inventory(path.join(root, "src"));
  assert.equal(execute("supplement-positive", runtimeArgs(supplementOnly ? "^S0[12] " : "^S01 ", "supplement.mjs")).status, 0);
  for (const mutation of plan.mutations.filter(row => !supplementOnly || row.id === "M05")) {
    const filename = path.join(root, mutation.file);
    const original = fs.readFileSync(filename, "utf8");
    assert.equal(original.split(mutation.before).length, 2, mutation.id);
    const changed = original.replace(mutation.before, mutation.after);
    result.mutations.push({ ...mutation, originalSha256: hash(original), changedSha256: hash(changed), original, changed });
    fs.writeFileSync(filename, changed);
    try {
      if (mutation.type) {
        const family = JSON.parse(fs.readFileSync(path.join(own, "../types.json"), "utf8")).find(row => row.id === mutation.type);
        const typeFile = path.join(root, "fixtures/mutant.mts");
        fs.writeFileSync(typeFile, family.source.replaceAll("$PUBLIC", path.join(root, "src/index.js")).replaceAll("$SHELL", path.join(root, "src/shell/index.js")));
        execute(mutation.id, [path.join(tooling, "typescript/bin/tsc"), "--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--exactOptionalPropertyTypes", "--noUncheckedIndexedAccess", "--skipLibCheck", "--types", "node", typeFile]);
      } else {
        execute(mutation.id, runtimeArgs(mutation.pattern));
        if (mutation.supplement) execute(`${mutation.id}-supplement`, runtimeArgs(supplementOnly ? "^S0[12] " : mutation.supplement, "supplement.mjs"));
      }
    } finally { fs.writeFileSync(filename, original); }
    assert.deepEqual(inventory(path.join(root, "src")), sourceBefore);
  }
  if (supplementOnly) {
    result.completed = true;
  } else {
  const loaderFixture = path.join(root, "fixtures/loader.mjs");
  fs.writeFileSync(loaderFixture, `await import(${JSON.stringify(pathToFileURL(path.join(root, "src/index.ts")).href)});`);
  const target = path.join(root, "src/index.ts");
  const originalTarget = fs.readFileSync(target);
  execute("G01-changed", ["--import", pathToFileURL(path.join(tooling, "tsx/dist/loader.mjs")).href, loaderFixture], {
    before() { fs.appendFileSync(target, "\n"); }, after() { fs.writeFileSync(target, originalTarget); },
  });
  fs.writeFileSync(loaderFixture, "await import('./unlisted.mjs');");
  const unlisted = path.join(root, "fixtures/unlisted.mjs");
  execute("G02-unlisted", [loaderFixture], { before() { fs.writeFileSync(unlisted, "export const value = 1;"); }, after() { fs.unlinkSync(unlisted); } });
  fs.writeFileSync(loaderFixture, `await import(${JSON.stringify(pathToFileURL(path.join(repository, "src/index.ts")).href)});`);
  execute("G03-live", ["--import", pathToFileURL(path.join(tooling, "tsx/dist/loader.mjs")).href, loaderFixture]);
  assert.deepEqual(inventory(path.join(root, "src")), sourceBefore);
  result.completed = true;
  }
} catch (error) {
  result.failure = { message: String(error), stack: error?.stack };
  process.exitCode = 1;
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
  result.temporaryRemoved = !fs.existsSync(temporary);
  const bytes = gzipSync(JSON.stringify(result), { level: 9 });
  fs.writeFileSync(output, bytes.toString("base64") + "\n", { flag: "wx" });
  console.log(JSON.stringify({ output, sha256: hash(bytes), completed: result.completed ?? false, failure: result.failure, temporaryRemoved: result.temporaryRemoved }));
}
