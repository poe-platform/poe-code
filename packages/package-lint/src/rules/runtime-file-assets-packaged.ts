import path from "node:path";
import {
  isGenuinelyPublished,
  type PackageInfo,
  type Rule,
  type Violation,
  type WorkspaceModel
} from "../model.js";
import type { PackagingSurface } from "../packlist.js";
import type { RuntimeFileAssetKind, RuntimeFileAssetRef } from "../runtime-files.js";

const id = "runtime-file-assets-packaged";

interface AssetCheck {
  kind: RuntimeFileAssetKind;
  sourceFile?: string;
  sourceRelPath?: string;
  runtimeRelPath: string;
  expression?: string;
  inferred: boolean;
}

function toPosix(p: string): string {
  return p.replaceAll("\\", "/");
}

function packageAllFiles(model: WorkspaceModel, packageDir: string): Set<string> {
  const fileSet = model.packageFiles.get(packageDir);
  return fileSet?.allFiles ?? fileSet?.files ?? new Set();
}

function hasRuntimeFile(model: WorkspaceModel, pkg: PackageInfo, runtimeRelPath: string): boolean {
  return packageAllFiles(model, pkg.dir).has(runtimeRelPath);
}

function hasRuntimeDirectory(
  model: WorkspaceModel,
  pkg: PackageInfo,
  runtimeRelPath: string
): boolean {
  const prefix = runtimeRelPath.endsWith("/") ? runtimeRelPath : `${runtimeRelPath}/`;
  for (const file of packageAllFiles(model, pkg.dir)) {
    if (file.startsWith(prefix)) return true;
  }
  return false;
}

function packlistIncludesFile(
  model: WorkspaceModel,
  packageDir: string,
  runtimeRelPath: string
): boolean {
  return model.packageFiles.get(packageDir)?.files.has(runtimeRelPath) ?? false;
}

function packlistIncludesDirectory(
  model: WorkspaceModel,
  packageDir: string,
  runtimeRelPath: string
): boolean {
  const prefix = runtimeRelPath.endsWith("/") ? runtimeRelPath : `${runtimeRelPath}/`;
  for (const file of model.packageFiles.get(packageDir)?.files ?? []) {
    if (file.startsWith(prefix)) return true;
  }
  return false;
}

function packageHasPackedAsset(
  model: WorkspaceModel,
  pkg: PackageInfo,
  asset: AssetCheck
): boolean {
  return asset.kind === "directory"
    ? packlistIncludesDirectory(model, pkg.dir, asset.runtimeRelPath)
    : packlistIncludesFile(model, pkg.dir, asset.runtimeRelPath);
}

function rootHasPackedAsset(model: WorkspaceModel, pkg: PackageInfo, asset: AssetCheck): boolean {
  const rootRelPath = toPosix(path.posix.join(pkg.dir, asset.runtimeRelPath));
  return asset.kind === "directory"
    ? packlistIncludesDirectory(model, ".", rootRelPath)
    : packlistIncludesFile(model, ".", rootRelPath);
}

function packagingSurfaces(model: WorkspaceModel, pkg: PackageInfo): PackagingSurface[] {
  const surfaces: PackagingSurface[] = [];
  if (isGenuinelyPublished(model, pkg)) surfaces.push("published-package");
  if (model.shippedDirs.has(pkg.dir)) surfaces.push("root-files");
  const bundledByPublished = model.packages.some(
    (candidate) =>
      candidate.dir !== pkg.dir &&
      candidate.bundledDependencies.includes(pkg.name) &&
      isGenuinelyPublished(model, candidate)
  );
  if (bundledByPublished) surfaces.push("bundled-dependency");
  return surfaces;
}

function assetsForPackage(model: WorkspaceModel, pkg: PackageInfo): AssetCheck[] {
  const refs = (model.runtimeFileAssets.get(pkg.dir) ?? [])
    .filter((ref): ref is RuntimeFileAssetRef => !ref.isTest && !ref.externalPackageRelPath)
    .map((ref) => ({
      kind: ref.kind,
      sourceFile: ref.sourceFile,
      sourceRelPath: ref.sourceRelPath,
      runtimeRelPath: ref.runtimeRelPath,
      expression: ref.expression,
      inferred: true
    }));
  const declared = pkg.runtimeAssets.map((asset) => ({
    kind: asset.kind ?? "file",
    sourceRelPath: asset.sourceRelPath,
    runtimeRelPath: asset.runtimeRelPath,
    expression: undefined,
    inferred: false
  }));
  const seen = new Set<string>();
  const out: AssetCheck[] = [];
  for (const asset of [...refs, ...declared]) {
    const key = `${asset.kind}\0${asset.runtimeRelPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(asset);
  }
  return out;
}

function runtimeExists(model: WorkspaceModel, pkg: PackageInfo, asset: AssetCheck): boolean {
  return asset.kind === "directory"
    ? hasRuntimeDirectory(model, pkg, asset.runtimeRelPath)
    : hasRuntimeFile(model, pkg, asset.runtimeRelPath);
}

function missingSurfaces(
  model: WorkspaceModel,
  pkg: PackageInfo,
  asset: AssetCheck,
  surfaces: PackagingSurface[]
): string[] {
  const missing: string[] = [];
  const exists = runtimeExists(model, pkg, asset);
  if (!exists) missing.push(asset.kind === "directory" ? "runtime-directory" : "runtime-file");

  for (const surface of surfaces) {
    if (surface === "root-files") {
      if (!rootHasPackedAsset(model, pkg, asset)) missing.push(surface);
      continue;
    }
    if (!packageHasPackedAsset(model, pkg, asset)) missing.push(surface);
  }
  return missing;
}

export const runtimeFileAssetsPackaged: Rule = {
  id,
  run(model) {
    const violations: Violation[] = [];
    for (const pkg of model.packages) {
      const surfaces = packagingSurfaces(model, pkg);
      if (surfaces.length === 0) continue;
      for (const asset of assetsForPackage(model, pkg)) {
        const missing = missingSurfaces(model, pkg, asset, surfaces);
        if (missing.length === 0) continue;
        const runtimePath = toPosix(path.posix.join(pkg.dir, asset.runtimeRelPath));
        violations.push({
          rule: id,
          package: pkg.name,
          severity: "error",
          via: asset.sourceFile
            ? `runtime-file:${asset.sourceFile}`
            : "runtime-assets:package.json",
          detail: {
            sourceFile: asset.sourceFile,
            runtimePath,
            sourcePath: asset.sourceRelPath
              ? toPosix(path.posix.join(pkg.dir, asset.sourceRelPath))
              : undefined,
            packagingSurfaces: surfaces,
            missing,
            expression: asset.expression,
            inferred: asset.inferred
          },
          message: `${pkg.name} uses a runtime file asset that is not included in every executable artifact`,
          fix:
            asset.kind === "directory"
              ? "Copy the directory into dist and ensure package files include that dist directory."
              : "Copy the asset into dist and ensure package files include that dist path."
        });
      }
    }
    return violations;
  }
};
