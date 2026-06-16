import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
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

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

export function sanitizeBundledWorkspaceManifest(manifest, bundledWorkspaceNames) {
  const sanitized = structuredClone(manifest);
  const dependencyFields = ["dependencies", "optionalDependencies", "peerDependencies"];

  for (const field of dependencyFields) {
    const dependencies = sanitized[field];
    if (!isObject(dependencies)) {
      continue;
    }

    for (const dependencyName of bundledWorkspaceNames) {
      delete dependencies[dependencyName];
    }

    if (Object.keys(dependencies).length === 0) {
      delete sanitized[field];
    }
  }

  for (const field of ["bundleDependencies", "bundledDependencies"]) {
    if (!Array.isArray(sanitized[field])) {
      continue;
    }

    const kept = sanitized[field].filter(
      (dependencyName) =>
        typeof dependencyName !== "string" || !bundledWorkspaceNames.has(dependencyName)
    );

    if (kept.length === 0) {
      delete sanitized[field];
    } else {
      sanitized[field] = kept;
    }
  }

  return sanitized;
}

function sanitizeExtractedManifest(packageDir, targetDir, bundledWorkspaceNames) {
  const packageJsonPath = path.join(targetDir, "package.json");
  assertSafeBundledPath(packageDir, packageJsonPath);
  const manifest = readJson(packageJsonPath);
  const sanitized = sanitizeBundledWorkspaceManifest(manifest, bundledWorkspaceNames);
  writeFileSync(packageJsonPath, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
}

export function assertSafeBundledPath(packageDir, targetPath, fileSystem = { existsSync, realpathSync }) {
  let existingPath = targetPath;
  while (!fileSystem.existsSync(existingPath)) {
    const parentPath = path.dirname(existingPath);
    if (parentPath === existingPath) {
      throw new Error("Bundled dependency output must remain inside the package directory.");
    }
    existingPath = parentPath;
  }

  const canonicalPackageDir = fileSystem.realpathSync(packageDir);
  const canonicalTargetPath = fileSystem.realpathSync(existingPath);
  const relativePath = path.relative(canonicalPackageDir, canonicalTargetPath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("Bundled dependency output must remain inside the package directory.");
  }
}

function prepare(packageDir, dependencyNames) {
  const tempDir = path.join(os.tmpdir(), `poe-code-bundled-workspace-deps-${process.pid}`);
  ensureRemoved(tempDir);
  mkdirSync(tempDir, { recursive: true });

  const bundledDirs = [];
  const bundledWorkspaceNames = new Set(dependencyNames);

  for (const dependencyName of dependencyNames) {
    const workspaceDir = findWorkspacePackageDir(dependencyName);
    const packOutput = execFileSync(
      "npm",
      ["pack", workspaceDir, "--json", "--pack-destination", tempDir, "--dry-run=false"],
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

    assertSafeBundledPath(packageDir, parentDir);
    assertSafeBundledPath(packageDir, targetDir);
    assertSafeBundledPath(packageDir, extractedDir);
    mkdirSync(parentDir, { recursive: true });
    ensureRemoved(targetDir);
    ensureRemoved(extractedDir);
    execFileSync("tar", ["-xzf", tarballPath, "-C", parentDir], { cwd: repoRoot });
    renameSync(extractedDir, targetDir);
    sanitizeExtractedManifest(packageDir, targetDir, bundledWorkspaceNames);
    bundledDirs.push(targetDir);
  }

  const stampPath = path.join(packageDir, stampFileName);
  assertSafeBundledPath(packageDir, stampPath);
  writeFileSync(
    stampPath,
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

  assertSafeBundledPath(packageDir, stampPath);
  const { bundledDirs } = readJson(stampPath);
  for (const bundledDir of bundledDirs) {
    assertSafeBundledPath(packageDir, bundledDir);
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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
}
