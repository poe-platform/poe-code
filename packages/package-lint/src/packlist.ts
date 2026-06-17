import path from "node:path";
import type { LintFs, WorkspaceModel } from "./model.js";

export type PackagingSurface = "published-package" | "root-files" | "bundled-dependency";

export interface PackageFileSet {
  packageDir: string;
  files: Set<string>;
  allFiles?: Set<string>;
}

export type PackageFileView = Map<string, PackageFileSet>;

export interface PacklistProvider {
  listPackageFiles(rootDir: string, packageDir: string): Promise<Set<string>>;
}

function toPosix(p: string): string {
  return p.replaceAll("\\", "/");
}

async function listAllFiles(fs: LintFs, dir: string): Promise<Set<string>> {
  if (fs.listFiles)
    return new Set((await fs.listFiles(dir)).map((file) => toPosix(path.relative(dir, file))));
  let entries: { name: string; isDirectory(): boolean }[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return new Set();
  }
  const files = new Set<string>();
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".turbo") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const child of await listAllFiles(fs, full))
        files.add(toPosix(path.join(entry.name, child)));
    } else {
      files.add(entry.name);
    }
  }
  return files;
}

async function listFilesEntry(
  fs: LintFs,
  packageRoot: string,
  entry: string
): Promise<Set<string>> {
  const normalized = toPosix(path.posix.normalize(entry));
  const abs = path.join(packageRoot, normalized);
  let dirents: { name: string; isDirectory(): boolean }[];
  try {
    dirents = await fs.readdir(abs);
  } catch {
    return new Set([normalized]);
  }
  const files = new Set<string>();
  for (const dirent of dirents) {
    const child = toPosix(path.posix.join(normalized, dirent.name));
    if (dirent.isDirectory()) {
      for (const nested of await listFilesEntry(fs, packageRoot, child)) files.add(nested);
    } else {
      files.add(child);
    }
  }
  return files;
}

async function listFallbackPackFiles(fs: LintFs, packageRoot: string): Promise<Set<string>> {
  let manifest: { files?: unknown };
  try {
    manifest = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"))) as {
      files?: unknown;
    };
  } catch {
    return listAllFiles(fs, packageRoot);
  }
  const allowlist = Array.isArray(manifest.files)
    ? manifest.files.filter((entry): entry is string => typeof entry === "string")
    : [];
  if (allowlist.length === 0) return listAllFiles(fs, packageRoot);

  const files = new Set<string>();
  for (const entry of allowlist) {
    for (const listed of await listFilesEntry(fs, packageRoot, entry)) files.add(listed);
  }
  return files;
}

export function createNpmPacklistProvider(fs?: LintFs): PacklistProvider {
  return {
    async listPackageFiles(rootDir, packageDir) {
      const packageRoot = path.join(rootDir, packageDir);
      try {
        const imported = (await Function(
          "specifier",
          "return import(specifier)"
        )("npm-packlist")) as { default?: (options: { path: string }) => Promise<string[]> };
        const packlist = imported.default;
        if (packlist) return new Set((await packlist({ path: packageRoot })).map(toPosix));
      } catch {
        // The declared dependency may not be installed in restricted workspaces.
      }
      if (!fs) return new Set();
      return listFallbackPackFiles(fs, packageRoot);
    }
  };
}

export async function loadPackageFileView(
  provider: PacklistProvider,
  input: { rootDir: string; model: Pick<WorkspaceModel, "root" | "packages">; fs?: LintFs }
): Promise<PackageFileView> {
  const view: PackageFileView = new Map();
  const packages = [input.model.root, ...input.model.packages];
  await Promise.all(
    packages.map(async (pkg) => {
      const packageDir = pkg.dir;
      const files = await provider.listPackageFiles(input.rootDir, packageDir);
      const allFiles =
        input.fs && packageDir !== "."
          ? await listAllFiles(input.fs, path.join(input.rootDir, packageDir))
          : undefined;
      view.set(packageDir, { packageDir, files, allFiles });
    })
  );
  return view;
}
