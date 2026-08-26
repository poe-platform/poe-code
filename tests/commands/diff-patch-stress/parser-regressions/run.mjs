import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const prefix = `evidence-${stamp}`;
const hash = value => createHash("sha256").update(value).digest("hex");
const snapshot = () => {
  const files = {};
  const walk = directory => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) walk(path);
      else if (item.name.endsWith(".ts")) files[relative(root, path)] = hash(readFileSync(path));
    }
  };
  for (const scope of ["src/commands/diff-patch", "src/contracts", "src/fs/memory"]) walk(join(root, scope));
  for (const file of ["fixtures.ts", "helpers.ts", "parser.test.ts", "run.mjs", "tsconfig.json"]) files[relative(root, join(owned, file))] = hash(readFileSync(join(owned, file)));
  return files;
};
const before = snapshot();
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
const startedAt = new Date().toISOString();
const tests = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", join(owned, "parser.test.ts")], {
  cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
  env: { ...process.env, PARSER_EVIDENCE: `${prefix}.json` },
});
writeFileSync(join(owned, `${prefix}.tap`), `${tests.stdout ?? ""}${tests.stderr ?? ""}`);
const typecheck = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "-p", join(owned, "tsconfig.json")], {
  cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 2 * 1024 * 1024,
});
const after = snapshot();
const changed = Object.keys({ ...before, ...after }).filter(path => before[path] !== after[path]);
const validation = {
  startedAt, completedAt: new Date().toISOString(), head, node: process.version,
  tests: { status: tests.status, signal: tests.signal, error: tests.error?.message, summary: tests.stdout?.split("\n").filter(line => /^# (tests|pass|fail|cancelled|skipped|todo|duration_ms) /u.test(line)) },
  typecheck: { status: typecheck.status, signal: typecheck.signal, error: typecheck.error?.message, stdout: typecheck.stdout, stderr: typecheck.stderr },
  changed, before, after,
};
writeFileSync(join(owned, `${prefix}-validation.json`), `${JSON.stringify(validation, null, 2)}\n`);
console.log(JSON.stringify({ prefix, ...validation.tests, typecheck: validation.typecheck, changed }, null, 2));
process.exitCode = tests.status === 0 && typecheck.status === 0 && !changed.length ? 0 : 1;
