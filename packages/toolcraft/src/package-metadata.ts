import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface PackageMetadata {
  name?: string;
  path: string;
  version?: string;
}

type PackageMetadataInput = string | URL;

function pathFromInput(from: PackageMetadataInput): string {
  if (from instanceof URL) {
    return fileURLToPath(from);
  }

  if (from.startsWith("file:")) {
    return fileURLToPath(from);
  }

  return path.resolve(from);
}

function getSearchDirectory(from: PackageMetadataInput): string {
  const resolved = pathFromInput(from);
  let searchPath = resolved;

  try {
    searchPath = realpathSync(resolved);
  } catch {
    searchPath = resolved;
  }

  try {
    return statSync(searchPath).isDirectory() ? searchPath : path.dirname(searchPath);
  } catch {
    return path.dirname(resolved);
  }
}

function readPackageMetadata(packageJsonPath: string): PackageMetadata | undefined {
  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    name?: unknown;
    version?: unknown;
  };
  const metadata: PackageMetadata = { path: packageJsonPath };

  if (typeof parsed.name === "string") {
    metadata.name = parsed.name;
  }

  if (typeof parsed.version === "string") {
    metadata.version = parsed.version;
  }

  return metadata;
}

export function findPackageMetadata(from: PackageMetadataInput): PackageMetadata | undefined {
  let current = getSearchDirectory(from);

  while (true) {
    const packageJsonPath = path.join(current, "package.json");

    if (existsSync(packageJsonPath)) {
      return readPackageMetadata(packageJsonPath);
    }

    const parent = path.dirname(current);

    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
}

export function packageMetadata(from: PackageMetadataInput = process.cwd()): PackageMetadata {
  const metadata = findPackageMetadata(from);

  if (metadata === undefined) {
    throw new Error(`No package.json found from ${pathFromInput(from)}.`);
  }

  return metadata;
}

export function findEntrypointPackageMetadata(entrypoint: string | undefined): PackageMetadata | undefined {
  if (entrypoint === undefined || entrypoint.length === 0) {
    return undefined;
  }

  if (!path.isAbsolute(entrypoint) && !entrypoint.startsWith("file:")) {
    return undefined;
  }

  return findPackageMetadata(entrypoint);
}
