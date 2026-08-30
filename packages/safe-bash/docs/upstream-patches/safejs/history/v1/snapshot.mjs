import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export function hashes(root) {
  const result = {};
  function visit(directory, prefix = "") {
    for (const name of readdirSync(directory).sort()) {
      if (["node_modules", ".git", "dist", ".cache", ".turbo"].includes(name)) continue;
      const relative = prefix + name;
      const path = join(directory, name);
      const stat = lstatSync(path);
      assert(!stat.isSymbolicLink(), `Symlink rejected: ${path}`);
      if (stat.isDirectory()) visit(path, `${relative}/`);
      else {
        assert(stat.isFile(), `Nonregular file rejected: ${path}`);
        result[relative] = createHash("sha256").update(readFileSync(path)).digest("hex");
      }
    }
  }
  visit(root);
  return result;
}

export function privateState(root) {
  const git = (...args) => execFileSync("git", ["-C", root, ...args], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, encoding: "utf8",
  }).trimEnd();
  return {
    recordedAt: new Date().toISOString(), revision: git("rev-parse", "HEAD"),
    status: git("status", "--porcelain=v1"),
    engine: hashes(join(root, "packages/safejs")),
    license: createHash("sha256").update(readFileSync(join(root, "LICENSE"))).digest("hex"),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const input = realpathSync(process.argv[2]);
  const temporary = mkdtempSync("/tmp/safe-bash-safejs-isolated-");
  const before = privateState(input);
  writeFileSync(join(temporary, "private-before-copy.json"), JSON.stringify(before, null, 2));
  const baseline = join(temporary, "baseline");
  mkdirSync(baseline);
  for (const name of ["packages", "src", "tests", "scripts", "LICENSE", "package.json", "package-lock.json", "tsconfig.json", "vitest.config.ts"]) {
    cpSync(join(input, name), join(baseline, name), {
      recursive: true,
      filter(source) {
        const stat = lstatSync(source);
        assert(!stat.isSymbolicLink(), `Source symlink rejected: ${source}`);
        assert(stat.isFile() || stat.isDirectory(), `Nonregular source rejected: ${source}`);
        return !["node_modules", ".git", "dist", ".cache", ".turbo"].includes(source.split("/").at(-1));
      },
    });
  }
  const after = privateState(input);
  writeFileSync(join(temporary, "private-after-copy.json"), JSON.stringify(after, null, 2));
  writeFileSync(join(temporary, "baseline-hashes.json"), JSON.stringify(hashes(join(baseline, "packages/safejs")), null, 2));
  assert.deepEqual(hashes(join(baseline, "packages/safejs")), before.engine, "Engine changed during snapshot");
  assert.deepEqual(after.engine, before.engine, "Private engine drift; evidence retained");
  const patched = join(temporary, "patched");
  cpSync(baseline, patched, { recursive: true });
  for (const snapshot of [baseline, patched]) {
    cpSync(join(input, "node_modules"), join(snapshot, "node_modules"), {
      recursive: true,
      filter: source => !lstatSync(source).isSymbolicLink() && ![".vite", ".cache"].includes(source.split("/").at(-1)),
    });
    mkdirSync(join(snapshot, "temporary"));
    mkdirSync(join(snapshot, "home"));
  }
  writeFileSync(join(temporary, "private-after-tooling-copy.json"), JSON.stringify(privateState(input), null, 2));
  console.log(JSON.stringify({ temporary, baseline, patched }));
}
