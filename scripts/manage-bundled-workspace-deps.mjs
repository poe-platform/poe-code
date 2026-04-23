import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const packagesDir = path.join(repoRoot, "packages");
const stampFileName = ".bundled-workspace-deps.json";

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function findWorkspacePackageDir(packageName) {
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageJsonPath = path.join(packagesDir, entry.name, "package.json");
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    const packageJson = readJson(packageJsonPath);
    if (packageJson.name === packageName) {
      return path.dirname(packageJsonPath);
    }
  }

  throw new Error(`Unable to find workspace package ${JSON.stringify(packageName)}.`);
}

function dependencyTargetDir(packageDir, dependencyName) {
  return path.join(packageDir, "node_modules", ...dependencyName.split("/"));
}

function dependencyParentDir(packageDir, dependencyName) {
  return path.dirname(dependencyTargetDir(packageDir, dependencyName));
}

function ensureRemoved(targetPath) {
  rmSync(targetPath, { recursive: true, force: true });
}

function prepare(packageDir, dependencyNames) {
  const tempDir = path.join(os.tmpdir(), `poe-code-bundled-workspace-deps-${process.pid}`);
  ensureRemoved(tempDir);
  mkdirSync(tempDir, { recursive: true });

  const bundledDirs = [];

  for (const dependencyName of dependencyNames) {
    const workspaceDir = findWorkspacePackageDir(dependencyName);
    const packOutput = execFileSync(
      "npm",
      ["pack", workspaceDir, "--json", "--pack-destination", tempDir],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );
    const [{ filename }] = JSON.parse(packOutput);
    const tarballPath = path.join(tempDir, filename);
    const parentDir = dependencyParentDir(packageDir, dependencyName);
    const targetDir = dependencyTargetDir(packageDir, dependencyName);
    const extractedDir = path.join(parentDir, "package");

    mkdirSync(parentDir, { recursive: true });
    ensureRemoved(targetDir);
    ensureRemoved(extractedDir);
    execFileSync("tar", ["-xzf", tarballPath, "-C", parentDir], { cwd: repoRoot });
    renameSync(extractedDir, targetDir);
    bundledDirs.push(targetDir);
  }

  writeFileSync(
    path.join(packageDir, stampFileName),
    JSON.stringify({ bundledDirs }, null, 2) + "\n",
    "utf8"
  );
  ensureRemoved(tempDir);
}

function cleanup(packageDir) {
  const stampPath = path.join(packageDir, stampFileName);
  if (!existsSync(stampPath)) {
    return;
  }

  const { bundledDirs } = readJson(stampPath);
  for (const bundledDir of bundledDirs) {
    ensureRemoved(bundledDir);
    const parentDir = path.dirname(bundledDir);
    if (existsSync(parentDir) && readdirSync(parentDir).length === 0) {
      ensureRemoved(parentDir);
    }
  }

  const nodeModulesDir = path.join(packageDir, "node_modules");
  if (existsSync(nodeModulesDir) && readdirSync(nodeModulesDir).length === 0) {
    ensureRemoved(nodeModulesDir);
  }

  ensureRemoved(stampPath);
}

const [mode, packageDirArg, ...dependencyNames] = process.argv.slice(2);

if (mode !== "prepare" && mode !== "cleanup") {
  throw new Error('Expected mode to be "prepare" or "cleanup".');
}

if (typeof packageDirArg !== "string") {
  throw new Error("Expected a package directory argument.");
}

const packageDir = path.resolve(process.cwd(), packageDirArg);

if (mode === "prepare") {
  prepare(packageDir, dependencyNames);
} else {
  cleanup(packageDir);
}
