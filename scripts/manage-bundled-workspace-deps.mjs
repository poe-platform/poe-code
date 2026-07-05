import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const packagesDir = path.join(repoRoot, "packages");
const stampFileName = ".bundled-workspace-deps.json";
const compositionFileName = "composition.json";

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

  return undefined;
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

function readCompositionPackage(packageDir, fileSystem) {
  const manifest = JSON.parse(
    fileSystem.readFileSync(path.join(packageDir, "package.json"), "utf8")
  );
  for (const field of ["name", "version", "license"]) {
    if (typeof manifest[field] !== "string" || manifest[field].length === 0) {
      throw new Error(`Bundled package ${packageDir} must declare a non-empty ${field}.`);
    }
  }

  return {
    name: manifest.name,
    version: manifest.version,
    license: manifest.license
  };
}

function listInstalledPackageDirs(nodeModulesDir, fileSystem) {
  if (!fileSystem.existsSync(nodeModulesDir)) {
    return [];
  }

  const packageDirs = [];
  for (const entry of fileSystem.readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name.startsWith(".")) {
      continue;
    }

    const entryDir = path.join(nodeModulesDir, entry.name);
    if (!entry.name.startsWith("@")) {
      packageDirs.push(entryDir);
      continue;
    }

    for (const scopedEntry of fileSystem.readdirSync(entryDir, { withFileTypes: true })) {
      if (scopedEntry.isDirectory()) {
        packageDirs.push(path.join(entryDir, scopedEntry.name));
      }
    }
  }

  return packageDirs;
}

function compareCompositionPackages(left, right) {
  for (const field of ["name", "version", "license"]) {
    if (left[field] < right[field]) {
      return -1;
    }
    if (left[field] > right[field]) {
      return 1;
    }
  }
  return 0;
}

export function createBundledCompositionManifest(
  packageDir,
  fileSystem = { existsSync, readFileSync, readdirSync }
) {
  const packages = new Map();

  function visit(currentPackageDir) {
    const entry = readCompositionPackage(currentPackageDir, fileSystem);
    packages.set(`${entry.name}\0${entry.version}\0${entry.license}`, entry);
    for (const dependencyDir of listInstalledPackageDirs(
      path.join(currentPackageDir, "node_modules"),
      fileSystem
    )) {
      visit(dependencyDir);
    }
  }

  visit(packageDir);

  return {
    schemaVersion: 1,
    packages: [...packages.values()].sort(compareCompositionPackages)
  };
}

export function sanitizeBundledWorkspaceManifest(manifest, bundledDependencyNames) {
  const sanitized = structuredClone(manifest);
  const dependencyFields = ["dependencies", "optionalDependencies", "peerDependencies"];

  for (const field of dependencyFields) {
    const dependencies = sanitized[field];
    if (!isObject(dependencies)) {
      continue;
    }

    for (const dependencyName of bundledDependencyNames) {
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
        typeof dependencyName !== "string" || !bundledDependencyNames.has(dependencyName)
    );

    if (kept.length === 0) {
      delete sanitized[field];
    } else {
      sanitized[field] = kept;
    }
  }

  return sanitized;
}

export function anonymizeBundledWorkspaceManifest(manifest) {
  const anonymized = structuredClone(manifest);
  delete anonymized.name;
  delete anonymized.version;
  return anonymized;
}

function anonymizeExtractedManifest(packageDir, targetDir) {
  const packageJsonPath = path.join(targetDir, "package.json");
  assertSafeBundledPath(packageDir, packageJsonPath);
  const manifest = readJson(packageJsonPath);
  const anonymized = anonymizeBundledWorkspaceManifest(manifest);
  writeFileSync(packageJsonPath, `${JSON.stringify(anonymized, null, 2)}\n`, "utf8");
}

function sanitizeExtractedManifest(packageDir, targetDir, bundledDependencyNames) {
  const packageJsonPath = path.join(targetDir, "package.json");
  assertSafeBundledPath(packageDir, packageJsonPath);
  const manifest = readJson(packageJsonPath);
  const sanitized = sanitizeBundledWorkspaceManifest(manifest, bundledDependencyNames);
  writeFileSync(packageJsonPath, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
}

export function assertSafeBundledPath(
  packageDir,
  targetPath,
  fileSystem = { existsSync, realpathSync }
) {
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

export function restoreGeneratedFiles(
  packageDir,
  generatedFiles,
  fileSystem = { existsSync, realpathSync, rmSync, writeFileSync }
) {
  for (const generatedFile of generatedFiles) {
    const generatedPath = typeof generatedFile === "string" ? generatedFile : generatedFile.path;
    assertSafeBundledPath(packageDir, generatedPath, fileSystem);
    if (typeof generatedFile === "object" && generatedFile.originalContent !== null) {
      fileSystem.writeFileSync(generatedPath, generatedFile.originalContent, "utf8");
    } else {
      fileSystem.rmSync(generatedPath, { recursive: true, force: true });
    }
  }
}

function prepare(packageDir, dependencyNames) {
  const tempDir = path.join(os.tmpdir(), `poe-code-bundled-workspace-deps-${process.pid}`);
  ensureRemoved(tempDir);
  mkdirSync(tempDir, { recursive: true });

  const bundledDirs = [];
  const bundledWorkspaceDirs = [];
  const bundledDependencyNames = new Set(dependencyNames);

  for (const dependencyName of dependencyNames) {
    const workspaceDir = findWorkspacePackageDir(dependencyName);
    if (workspaceDir === undefined) {
      bundledDirs.push(copyInstalledDependency(packageDir, dependencyName));
      continue;
    }
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
    sanitizeExtractedManifest(packageDir, targetDir, bundledDependencyNames);
    bundledDirs.push(targetDir);
    bundledWorkspaceDirs.push(targetDir);
  }

  const stampPath = path.join(packageDir, stampFileName);
  const compositionPaths = [
    path.join(packageDir, compositionFileName),
    path.join(packageDir, "dist", compositionFileName)
  ];
  const generatedFiles = compositionPaths.map((generatedPath) => ({
    path: generatedPath,
    originalContent: existsSync(generatedPath) ? readFileSync(generatedPath, "utf8") : null
  }));
  assertSafeBundledPath(packageDir, stampPath);
  const compositionContent = `${JSON.stringify(
    createBundledCompositionManifest(packageDir),
    null,
    2
  )}\n`;
  for (const compositionPath of compositionPaths) {
    assertSafeBundledPath(packageDir, compositionPath);
    writeFileSync(compositionPath, compositionContent, "utf8");
  }
  for (const bundledWorkspaceDir of bundledWorkspaceDirs) {
    anonymizeExtractedManifest(packageDir, bundledWorkspaceDir);
  }
  writeFileSync(
    stampPath,
    JSON.stringify({ bundledDirs, generatedFiles }, null, 2) + "\n",
    "utf8"
  );
  ensureRemoved(tempDir);
}

function copyInstalledDependency(packageDir, dependencyName) {
  const sourceDir = dependencyTargetDir(repoRoot, dependencyName);
  if (!existsSync(sourceDir)) {
    throw new Error(`Bundled dependency is not installed: ${dependencyName}`);
  }
  const parentDir = dependencyParentDir(packageDir, dependencyName);
  const targetDir = dependencyTargetDir(packageDir, dependencyName);
  assertSafeBundledPath(packageDir, parentDir);
  assertSafeBundledPath(packageDir, targetDir);
  mkdirSync(parentDir, { recursive: true });
  ensureRemoved(targetDir);
  cpSync(sourceDir, targetDir, { recursive: true, dereference: true });
  return targetDir;
}

function cleanup(packageDir) {
  const stampPath = path.join(packageDir, stampFileName);
  if (!existsSync(stampPath)) {
    return;
  }

  assertSafeBundledPath(packageDir, stampPath);
  const { bundledDirs, generatedFiles = [] } = readJson(stampPath);
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

  restoreGeneratedFiles(packageDir, generatedFiles);

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
