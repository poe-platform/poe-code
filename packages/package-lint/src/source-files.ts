import path from "node:path";
import type { LintFs, LintStat } from "./model.js";

const unownedDirectories = new Set(["node_modules", ".git", ".turbo"]);

type InspectedPath =
  | { excluded: true }
  | { excluded: false; entries: { path: string; stat: LintStat }[] };

export function fileIdentity(stat: LintStat): string {
  if (
    ![stat.dev, stat.ino].every((value) => typeof value === "number" || typeof value === "bigint")
  ) {
    throw new Error("Source metadata must provide device and inode identity");
  }
  return `${stat.dev}:${stat.ino}`;
}

function within(directory: string, file: string): boolean {
  const relative = path.relative(directory, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function createSourceAdmission(
  fs: LintFs,
  rootDir: string,
  packageDir: string,
  sourceExclude: readonly string[]
) {
  if (!fs.lstat || !fs.realpath) {
    throw new Error("Source admission requires lstat and realpath metadata support");
  }
  const lstat = fs.lstat.bind(fs);
  const realpath = fs.realpath.bind(fs);
  const root = path.resolve(rootDir);
  const packageRoot = path.resolve(rootDir, packageDir);
  const cache = new Map<string, Promise<LintStat | undefined>>();
  const excludedIdentities = new Set<string>();
  let canonicalPackage = root;
  async function metadata(file: string): Promise<LintStat | undefined> {
    let pending = cache.get(file);
    if (!pending) {
      pending = lstat(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
        throw new Error(`Unable to inspect source metadata: ${file}`, { cause: error });
      });
      cache.set(file, pending);
    }
    return pending;
  }
  async function inspect(
    file: string,
    boundary = packageRoot,
    canonicalBoundary = canonicalPackage,
    applyExclusions = true
  ): Promise<InspectedPath | undefined> {
    if (!within(boundary, file)) throw new Error(`Source path escapes package ownership: ${file}`);
    const relative = path.relative(boundary, file);
    const segments = relative ? relative.split(path.sep) : [];
    const entries: { path: string; stat: LintStat }[] = [];
    let current = boundary;
    for (let index = 0; index <= segments.length; index += 1) {
      if (index > 0) current = path.join(current, segments[index - 1]);
      const packageRelative = path.relative(packageRoot, current).split(path.sep).join("/");
      if (
        applyExclusions &&
        sourceExclude.some(
          (excluded) => packageRelative === excluded || packageRelative.startsWith(`${excluded}/`)
        )
      ) {
        return { excluded: true };
      }
      const stat = await metadata(current);
      if (!stat) return undefined;
      const identity = fileIdentity(stat);
      if (applyExclusions && excludedIdentities.has(identity)) return { excluded: true };
      if (
        stat.isSymbolicLink() ||
        (!stat.isDirectory() && !stat.isFile()) ||
        (index < segments.length && !stat.isDirectory())
      ) {
        throw new Error(
          `Unsupported source path (requires regular files and real directories): ${current}`
        );
      }
      entries.push({ path: current, stat });
    }
    const canonical = await realpath(file);
    if (!within(canonicalBoundary, canonical)) {
      throw new Error(`Canonical source path escapes package ownership: ${file}`);
    }
    const canonicalRelative = path.relative(canonicalBoundary, canonical).split(path.sep).join("/");
    if (
      applyExclusions &&
      sourceExclude.some(
        (excluded) => canonicalRelative === excluded || canonicalRelative.startsWith(`${excluded}/`)
      )
    ) {
      return { excluded: true };
    }
    return { excluded: false, entries };
  }
  const rootStat = await metadata(root);
  if (rootStat && (!rootStat.isDirectory() || rootStat.isSymbolicLink())) {
    throw new Error(`Unsupported source workspace directory: ${root}`);
  }
  const canonicalRoot = rootStat ? await realpath(root) : root;
  const packageMetadata = await inspect(packageRoot, root, canonicalRoot, false);
  const packageStat =
    packageMetadata && !packageMetadata.excluded ? packageMetadata.entries.at(-1)?.stat : undefined;
  if (packageStat && !packageStat.isDirectory())
    throw new Error(`Unsupported source package directory: ${packageRoot}`);
  canonicalPackage = packageStat ? await realpath(packageRoot) : packageRoot;
  for (const excluded of sourceExclude) {
    const stat = await metadata(path.join(packageRoot, excluded));
    if (stat) excludedIdentities.add(fileIdentity(stat));
  }
  return { packageRoot, stat: packageStat, inspect };
}

export function validateSourceExclude(value: unknown, packageDir: string): readonly string[] {
  if (value === undefined) return [];
  const context = `${packageDir}/package.json: poeCode.packageLint.sourceExclude`;
  if (!Array.isArray(value)) throw new Error(`${context} must be an array of literal paths`);
  const paths: string[] = [];
  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      !entry.startsWith("src/") ||
      entry
        .split("/")
        .some((part) => !part || part === "." || part === ".." || part.trim() !== part) ||
      [...entry].some(
        (character) =>
          "\\:*?[]{}!()".includes(character) ||
          character.charCodeAt(0) < 32 ||
          character.charCodeAt(0) === 127
      )
    ) {
      throw new Error(
        `${context} entries must be literal paths strictly below src: ${JSON.stringify(entry)}`
      );
    }
    if (paths.includes(entry)) throw new Error(`${context} contains duplicate path: ${entry}`);
    paths.push(entry);
  }
  return paths;
}

export function parseSourceExclude(config: unknown, packageDir: string): readonly string[] {
  if (config === undefined) return [];
  const context = `${packageDir}/package.json: poeCode.packageLint`;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`${context} must be an object containing sourceExclude`);
  }
  const record = config as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Object.hasOwn(record, "sourceExclude")) {
    throw new Error(`${context} must contain only sourceExclude`);
  }
  if (record.sourceExclude === undefined) {
    throw new Error(`${context}.sourceExclude must be an array of literal paths`);
  }
  return validateSourceExclude(record.sourceExclude, packageDir);
}

function isSourceFile(name: string): boolean {
  if (name.endsWith(".d.ts") || name.endsWith(".d.mts") || name.endsWith(".d.cts")) return false;
  return [".ts", ".tsx", ".mts", ".cts"].some((extension) => name.endsWith(extension));
}

export async function listSourceFiles(
  fs: LintFs,
  rootDir: string,
  packageDir: string,
  sourceExclude: readonly string[]
): Promise<string[]> {
  const admission = await createSourceAdmission(fs, rootDir, packageDir, sourceExclude);
  const admits = (file: string): boolean => {
    const relative = path.relative(admission.packageRoot, file).split(path.sep).join("/");
    const segments = relative.split("/");
    return segments[0] === "src" && !segments.some((segment) => unownedDirectories.has(segment));
  };
  const srcDir = path.join(admission.packageRoot, "src");
  const src = await admission.inspect(srcDir);
  if (!src || src.excluded) return [];
  if (!src.entries.at(-1)!.stat.isDirectory())
    throw new Error(`Unsupported source directory: ${srcDir}`);
  if (fs.listFiles) {
    let listed: string[];
    try {
      listed = await fs.listFiles(srcDir);
    } catch {
      return [];
    }
    const files: string[] = [];
    for (const file of listed) {
      if (!admits(file)) continue;
      const inspected = await admission.inspect(file);
      if (!inspected || inspected.excluded) continue;
      if (inspected.entries.at(-1)!.stat.isFile() && isSourceFile(file)) files.push(file);
    }
    return files;
  }
  const visit = async (dir: string): Promise<string[]> => {
    let entries: { name: string; isDirectory(): boolean }[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }
    const files: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (!admits(full)) continue;
      const inspected = await admission.inspect(full);
      if (!inspected || inspected.excluded) continue;
      if (inspected.entries.at(-1)!.stat.isDirectory()) {
        files.push(...(await visit(full)));
      } else if (isSourceFile(entry.name)) {
        files.push(full);
      }
    }
    return files;
  };
  return visit(srcDir);
}
