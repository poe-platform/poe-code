#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, readdir } from "node:fs/promises";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, "..");
const packagesDir = path.join(rootDir, "packages");

const workspaceDirs = await readdir(packagesDir, { withFileTypes: true });
const workspaceNames = new Set();

// First pass: collect all workspace package names
for (const dir of workspaceDirs.filter((d) => d.isDirectory())) {
  const pkgPath = path.join(packagesDir, dir.name, "package.json");
  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    workspaceNames.add(pkg.name);
  } catch {
    // Skip packages without package.json
  }
}

// Second pass: collect external deps per package
const packageDeps = [];

for (const dir of workspaceDirs.filter((d) => d.isDirectory())) {
  const pkgPath = path.join(packagesDir, dir.name, "package.json");
  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    const deps = Object.keys(pkg.dependencies || {}).filter(
      (dep) => !workspaceNames.has(dep)
    );
    if (deps.length > 0) {
      packageDeps.push({ name: pkg.name, deps });
    }
  } catch {
    // Skip
  }
}

// Output
console.log("Workspace package external dependencies:\n");

for (const { name, deps } of packageDeps.sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`${name}:`);
  for (const dep of deps.sort()) {
    console.log(`  - ${dep}`);
  }
  console.log();
}

// Summary
const allDeps = new Set(packageDeps.flatMap((p) => p.deps));
console.log("---");
console.log(`Total unique external deps from workspace packages: ${allDeps.size}`);
console.log([...allDeps].sort().join(", "));
