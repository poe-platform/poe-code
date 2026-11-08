import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const dependencyFields = ["dependencies", "peerDependencies", "optionalDependencies"];

function assertManifest(manifest, packageDir) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`Expected ${packageDir}/package.json to contain an object.`);
  }
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    throw new Error(`Expected ${packageDir}/package.json to declare a package name.`);
  }
}

export function prepareLockstepRelease(manifests, version) {
  if (!semver.valid(version)) {
    throw new Error(`Expected a concrete semantic version, received ${JSON.stringify(version)}.`);
  }
  if (!(manifests instanceof Map) || manifests.size < 2) {
    throw new Error("A lockstep release requires at least two packages.");
  }

  const names = new Set();
  for (const [packageDir, manifest] of manifests) {
    assertManifest(manifest, packageDir);
    if (names.has(manifest.name)) {
      throw new Error(`Duplicate package name ${JSON.stringify(manifest.name)}.`);
    }
    names.add(manifest.name);
  }

  for (const manifest of manifests.values()) {
    manifest.version = version;
    for (const field of dependencyFields) {
      const dependencies = manifest[field];
      if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies))
        continue;
      for (const dependency of Object.keys(dependencies)) {
        if (names.has(dependency)) dependencies[dependency] = version;
      }
    }
  }
}

function parsePackageDirs(raw) {
  let packageDirs;
  try {
    packageDirs = JSON.parse(raw);
  } catch {
    throw new Error("LOCKSTEP_RELEASE_PACKAGES must be a JSON array of package directories.");
  }
  if (
    !Array.isArray(packageDirs) ||
    packageDirs.length < 2 ||
    packageDirs.some((packageDir) => typeof packageDir !== "string" || packageDir.length === 0)
  ) {
    throw new Error("LOCKSTEP_RELEASE_PACKAGES must contain at least two package directories.");
  }
  return packageDirs;
}

function runFromEnvironment() {
  const version = process.env.LOCKSTEP_RELEASE_VERSION;
  const rawPackageDirs = process.env.LOCKSTEP_RELEASE_PACKAGES;
  if (!version) throw new Error("LOCKSTEP_RELEASE_VERSION is required.");
  if (!rawPackageDirs) throw new Error("LOCKSTEP_RELEASE_PACKAGES is required.");

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const packageDirs = parsePackageDirs(rawPackageDirs);
  const manifests = new Map(
    packageDirs.map((packageDir) => {
      const packageJsonPath = path.resolve(repoRoot, packageDir, "package.json");
      const relativePath = path.relative(repoRoot, packageJsonPath);
      if (
        relativePath === ".." ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
      ) {
        throw new Error(`Package directory escapes the repository: ${JSON.stringify(packageDir)}.`);
      }
      return [packageDir, JSON.parse(readFileSync(packageJsonPath, "utf8"))];
    })
  );

  prepareLockstepRelease(manifests, version);
  for (const [packageDir, manifest] of manifests) {
    writeFileSync(
      path.resolve(repoRoot, packageDir, "package.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFromEnvironment();
}
