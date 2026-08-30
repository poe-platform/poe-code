import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  createNpmPacklistProvider,
  loadPackageFileView,
  type PackageFileView,
  type PacklistProvider
} from "./packlist.js";
import {
  scanRuntimeFileAssets,
  type RuntimeAssetDeclaration,
  type RuntimeFileAssetView
} from "./runtime-files.js";
import { scanImportFiles, scanSourceImports, type SourceImportView } from "./source-imports.js";
import { parseSourceExclude } from "./source-files.js";

/**
 * Minimal filesystem surface the analyzer needs. Injected so the CLI can pass
 * the real `fs/promises` and tests can pass an in-memory `memfs` volume.
 * `readFile` always returns a UTF-8 string; adapters bind the encoding.
 */
export interface LintFs {
  readFile(p: string): Promise<string>;
  readdir(p: string): Promise<{ name: string; isDirectory(): boolean }[]>;
  stat?(p: string): Promise<{ isDirectory(): boolean; isFile(): boolean }>;
  lstat?(p: string): Promise<LintStat>;
  realpath?(p: string): Promise<string>;
  listFiles?(p: string): Promise<string[]>;
}

export interface LintStat {
  dev: number | bigint;
  ino: number | bigint;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export type Ecosystem = "npm" | "pypi";

export type DependencyField = "dependencies" | "peerDependencies" | "optionalDependencies";

export interface PackageInfo {
  name: string;
  /** Path relative to the workspace root, posix-style. "." for the root package. */
  dir: string;
  isRoot: boolean;
  private: boolean;
  version: string;
  license: string | undefined;
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  /** Names vendored into this package's published tarball (npm `bundledDependencies`). */
  bundledDependencies: string[];
  /** Workspace packages compiled into this package's published runtime and type entrypoints. */
  inlinedDependencies: string[];
  repositoryDirectory: string | undefined;
  ecosystem: Ecosystem;
  main: string | undefined;
  exports: unknown;
  bin: Record<string, string>;
  files: string[];
  scripts: Record<string, string>;
  runtimeAssets: RuntimeAssetDeclaration[];
  sourceExclude?: readonly string[];
  hasReadme: boolean;
}

export interface BinTarget {
  /** Bin name as declared in root `bin`, e.g. "poe-superintendent-mcp". */
  bin: string;
  /** Target path as declared, e.g. "packages/superintendent/dist/mcp.js". */
  target: string;
  /** Owning package dir, e.g. "packages/superintendent". */
  dir: string;
}

export interface RootEntryPoint {
  kind: "main" | "export" | "bin";
  name: string;
  target: string;
}

export interface ReleaseWorkflow {
  /** File name, e.g. "release-toolcraft.yml". */
  file: string;
  /** The workflow `name:` field. */
  name: string;
  /** Package dirs this workflow publishes, posix-style. "." for the root. */
  targetDirs: string[];
  /** Package groups whose versions and intra-group dependencies are prepared together. */
  lockstepGroups: LockstepGroup[];
}

export interface LockstepGroup {
  dirs: string[];
  publishedDirs: string[];
  valid: boolean;
}

export interface WorkspaceModel {
  root: PackageInfo;
  packages: PackageInfo[];
  byName: Map<string, PackageInfo>;
  byDir: Map<string, PackageInfo>;
  releaseWorkflows: ReleaseWorkflow[];
  /** Package dirs whose dist reaches the published `poe-code` tarball. */
  shippedDirs: Set<string>;
  binTargets: BinTarget[];
  /** Real import graph of each package's `src`, keyed by package dir. */
  sourceImports: SourceImportView;
  /** Runtime imports of root package entrypoints that ship in the root tarball. */
  shippedDistImports: SourceImportView;
  rootEntryPoints: RootEntryPoint[];
  /** Runtime file assets discovered from package source, keyed by package dir. */
  runtimeFileAssets: RuntimeFileAssetView;
  /** Files included by each package artifact, keyed by package dir. */
  packageFiles: PackageFileView;
}

export interface BuildView {
  /** Package dirs whose source got inlined into a bundle. */
  inlinedDirs: Set<string>;
  /** Bare specifiers left external by the bundle, reduced to package names. */
  externals: Set<string>;
}

export interface Violation {
  rule: string;
  package: string;
  severity: "error" | "warning";
  via?: string;
  detail: Record<string, unknown>;
  message: string;
  /** One-line hint on how to resolve the violation. */
  fix: string;
}

export interface LintResult {
  summary: { packages: number; rules: number; violations: number; ok: boolean };
  /** Rule ids that ran, in registry order — drives the report's rule list. */
  evaluated: string[];
  violations: Violation[];
  skipped: string[];
}

export interface Rule {
  id: string;
  /** When true, the rule is skipped (not failed) if no BuildView is available. */
  requiresBuild?: boolean;
  run(model: WorkspaceModel, build?: BuildView): Violation[];
}

function toPosix(p: string): string {
  return p.replaceAll("\\", "/");
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") out[key] = raw;
  }
  return out;
}

function toBinRecord(value: unknown, packageName: string): Record<string, string> {
  if (typeof value === "string") return { [packageName]: value };
  return toStringRecord(value);
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function normalizeAssetPath(value: string): string | undefined {
  const normalized = toPosix(path.posix.normalize(value));
  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function inferAssetKind(runtimeRelPath: string): "file" | "directory" {
  const base = path.posix.basename(runtimeRelPath);
  return base.includes(".") ? "file" : "directory";
}

function parseRuntimeAssets(pkg: Record<string, unknown>): RuntimeAssetDeclaration[] {
  const poeCode = pkg.poeCode && typeof pkg.poeCode === "object" ? pkg.poeCode : undefined;
  const raw =
    poeCode && !Array.isArray(poeCode)
      ? (poeCode as Record<string, unknown>).runtimeAssets
      : undefined;
  if (!Array.isArray(raw)) return [];
  const assets: RuntimeAssetDeclaration[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const runtimeRelPath = normalizeAssetPath(entry);
      if (runtimeRelPath) assets.push({ runtimeRelPath, kind: inferAssetKind(runtimeRelPath) });
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.runtime !== "string") continue;
    const runtimeRelPath = normalizeAssetPath(record.runtime);
    const sourceRelPath =
      typeof record.source === "string" ? normalizeAssetPath(record.source) : undefined;
    const kind = record.kind === "file" || record.kind === "directory" ? record.kind : undefined;
    if (runtimeRelPath) {
      assets.push({
        runtimeRelPath,
        sourceRelPath,
        kind: kind ?? inferAssetKind(runtimeRelPath)
      });
    }
  }
  return assets;
}

const PYTHON_MARKERS = new Set(["pyproject.toml", "setup.py", "setup.cfg"]);

async function loadPackage(
  fs: LintFs,
  rootDir: string,
  relDir: string,
  isRoot: boolean
): Promise<PackageInfo | undefined> {
  const absDir = isRoot ? rootDir : path.join(rootDir, relDir);
  let entries: { name: string; isDirectory(): boolean }[];
  try {
    entries = await fs.readdir(absDir);
  } catch {
    return undefined;
  }
  if (!entries.some((e) => e.name === "package.json")) return undefined;
  const ecosystem: Ecosystem = entries.some((e) => PYTHON_MARKERS.has(e.name)) ? "pypi" : "npm";

  const raw = await fs.readFile(path.join(absDir, "package.json"));
  const pkg = JSON.parse(raw) as Record<string, unknown>;
  const repository = pkg.repository as { directory?: unknown } | undefined;
  const poeCode =
    pkg.poeCode && typeof pkg.poeCode === "object" && !Array.isArray(pkg.poeCode)
      ? (pkg.poeCode as Record<string, unknown>)
      : undefined;

  return {
    name: typeof pkg.name === "string" ? pkg.name : relDir,
    dir: isRoot ? "." : toPosix(relDir),
    isRoot,
    private: pkg.private === true,
    version: typeof pkg.version === "string" ? pkg.version : "0.0.0",
    license: typeof pkg.license === "string" ? pkg.license : undefined,
    dependencies: toStringRecord(pkg.dependencies),
    peerDependencies: toStringRecord(pkg.peerDependencies),
    optionalDependencies: toStringRecord(pkg.optionalDependencies),
    bundledDependencies: toStringArray(pkg.bundledDependencies ?? pkg.bundleDependencies),
    inlinedDependencies: toStringArray(poeCode?.inlinedDependencies),
    repositoryDirectory:
      typeof repository?.directory === "string" ? repository.directory : undefined,
    ecosystem,
    main: typeof pkg.main === "string" ? pkg.main : undefined,
    exports: pkg.exports,
    bin: toBinRecord(pkg.bin, typeof pkg.name === "string" ? pkg.name : relDir),
    files: Array.isArray(pkg.files)
      ? (pkg.files.filter((f) => typeof f === "string") as string[])
      : [],
    scripts: toStringRecord(pkg.scripts),
    runtimeAssets: parseRuntimeAssets(pkg),
    sourceExclude: parseSourceExclude(poeCode?.packageLint, relDir),
    hasReadme: entries.some((e) => e.name === "README.md" && !e.isDirectory())
  };
}

function packageDirOf(targetPath: string): string | undefined {
  const parts = toPosix(targetPath).split("/").filter(Boolean);
  if (parts[0] !== "packages" || parts.length < 2) return undefined;
  return `packages/${parts[1]}`;
}

function deriveShipped(root: PackageInfo): {
  shippedDirs: Set<string>;
  binTargets: BinTarget[];
} {
  const shippedDirs = new Set<string>();
  const binTargets: BinTarget[] = [];
  for (const entry of root.files) {
    const dir = packageDirOf(entry);
    if (dir) shippedDirs.add(dir);
  }
  for (const [bin, target] of Object.entries(root.bin)) {
    const dir = packageDirOf(target);
    if (!dir) continue;
    shippedDirs.add(dir);
    binTargets.push({ bin, target: toPosix(target), dir });
  }
  return { shippedDirs, binTargets };
}

function normalizeRootTarget(target: string): string | undefined {
  const withoutDot = target.startsWith("./") ? target.slice(2) : target;
  const normalized = toPosix(path.posix.normalize(toPosix(withoutDot)));
  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function exportImportTarget(value: unknown): string | undefined {
  if (typeof value === "string") return normalizeRootTarget(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const target = exportImportTarget(item);
      if (target) return target;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const [key, raw] of Object.entries(record)) {
    if (key === "types") continue;
    const target = exportImportTarget(raw);
    if (target) return target;
  }
  return undefined;
}

function isSubpathExportsMap(exportsField: unknown): exportsField is Record<string, unknown> {
  if (!exportsField || typeof exportsField !== "object" || Array.isArray(exportsField)) {
    return false;
  }
  return Object.keys(exportsField as Record<string, unknown>).some((key) => key.startsWith("."));
}

function deriveRootEntryPoints(root: PackageInfo): RootEntryPoint[] {
  const entryPoints: RootEntryPoint[] = [];
  const seen = new Set<string>();
  const add = (entry: RootEntryPoint): void => {
    const key = `${entry.kind}:${entry.name}:${entry.target}`;
    if (seen.has(key)) return;
    seen.add(key);
    entryPoints.push(entry);
  };

  if (root.main) {
    const target = normalizeRootTarget(root.main);
    if (target) add({ kind: "main", name: ".", target });
  }

  if (isSubpathExportsMap(root.exports)) {
    for (const [name, value] of Object.entries(root.exports)) {
      const target = exportImportTarget(value);
      if (target) add({ kind: "export", name, target });
    }
  } else {
    const target = exportImportTarget(root.exports);
    if (target) add({ kind: "export", name: ".", target });
  }

  for (const [name, value] of Object.entries(root.bin)) {
    const target = normalizeRootTarget(value);
    if (target) add({ kind: "bin", name, target });
  }

  return entryPoints.sort((a, b) => {
    const byTarget = a.target.localeCompare(b.target);
    if (byTarget !== 0) return byTarget;
    const byKind = a.kind.localeCompare(b.kind);
    return byKind !== 0 ? byKind : a.name.localeCompare(b.name);
  });
}

function dirFromArtifactPath(p: string): string {
  const parts = toPosix(p).split("/").filter(Boolean);
  if (parts[parts.length - 1] === "dist") parts.pop();
  return parts.join("/");
}

function normalizeWorkingDir(wd: string): string {
  let p = toPosix(wd);
  if (p.startsWith("./")) p = p.slice(2);
  return p.endsWith("/") ? p.slice(0, -1) : p;
}

interface WorkflowStep {
  run?: unknown;
  uses?: unknown;
  with?: Record<string, unknown>;
  "working-directory"?: unknown;
}

interface WorkflowJob {
  defaults?: {
    run?: {
      "working-directory"?: unknown;
    };
  };
  steps?: unknown;
}

function splitShellLine(line: string): string[] {
  return line
    .trim()
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
}

function hasPublishRun(run: string): boolean {
  for (const line of run.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const parts = splitShellLine(trimmed);
    if (parts[0] === "npm" && parts[1] === "publish") return true;
    if (parts.includes("semantic-release")) return true;
  }
  return false;
}

function isPypiPublishAction(uses: string): boolean {
  return uses === "pypa/gh-action-pypi-publish" || uses.startsWith("pypa/gh-action-pypi-publish@");
}

function parseLockstepGroup(value: unknown): { dirs: string[]; valid: boolean } {
  if (typeof value !== "string") return { dirs: [], valid: false };
  try {
    const group = JSON.parse(value) as unknown;
    if (!Array.isArray(group) || group.some((dir) => typeof dir !== "string" || dir.length === 0)) {
      return { dirs: [], valid: false };
    }
    return { dirs: group, valid: true };
  } catch {
    return { dirs: [], valid: false };
  }
}

function parseReleaseWorkflow(file: string, raw: string): ReleaseWorkflow {
  let doc: { name?: unknown; jobs?: unknown } | undefined;
  try {
    doc = parseYaml(raw) as { name?: unknown; jobs?: unknown };
  } catch {
    doc = undefined;
  }
  const name = typeof doc?.name === "string" ? doc.name : file;
  const targetDirs = new Set<string>();
  const lockstepGroups: LockstepGroup[] = [];
  const jobs =
    doc?.jobs && typeof doc.jobs === "object" ? (doc.jobs as Record<string, unknown>) : {};

  for (const job of Object.values(jobs)) {
    const workflowJob = job && typeof job === "object" ? (job as WorkflowJob) : {};
    const activeLockstepGroups: LockstepGroup[] = [];
    const steps = Array.isArray(workflowJob.steps) ? (workflowJob.steps as WorkflowStep[]) : [];
    const defaultWorkingDir =
      typeof workflowJob.defaults?.run?.["working-directory"] === "string"
        ? normalizeWorkingDir(workflowJob.defaults.run["working-directory"])
        : undefined;
    for (const step of steps) {
      const run = typeof step.run === "string" ? step.run : "";
      const uses = typeof step.uses === "string" ? step.uses : "";
      const wd =
        typeof step["working-directory"] === "string"
          ? normalizeWorkingDir(step["working-directory"] as string)
          : defaultWorkingDir;

      if (hasPublishRun(run)) {
        const targetDir = wd ?? ".";
        targetDirs.add(targetDir);
        for (const group of activeLockstepGroups) {
          if (group.dirs.includes(targetDir)) group.publishedDirs.push(targetDir);
        }
      }
      if (isPypiPublishAction(uses)) {
        const pd = step.with?.["packages-dir"];
        if (typeof pd === "string") targetDirs.add(dirFromArtifactPath(pd));
      }
      if (uses === "./.github/actions/prepare-lockstep-release") {
        const parsed = parseLockstepGroup(step.with?.packages);
        const validVersion =
          typeof step.with?.version === "string" && step.with.version.trim().length > 0;
        const group = { ...parsed, valid: parsed.valid && validVersion, publishedDirs: [] };
        lockstepGroups.push(group);
        activeLockstepGroups.push(group);
      }
    }
  }
  return { file, name, targetDirs: [...targetDirs].sort(), lockstepGroups };
}

async function loadReleaseWorkflows(fs: LintFs, rootDir: string): Promise<ReleaseWorkflow[]> {
  const dir = path.join(rootDir, ".github", "workflows");
  let entries: { name: string; isDirectory(): boolean }[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const files = entries
    .filter(
      (e) =>
        !e.isDirectory() &&
        e.name.startsWith("release") &&
        (e.name.endsWith(".yml") || e.name.endsWith(".yaml"))
    )
    .map((e) => e.name)
    .sort();
  const workflows = await Promise.all(
    files.map(async (file) => parseReleaseWorkflow(file, await fs.readFile(path.join(dir, file))))
  );
  return workflows;
}

export async function loadWorkspace(
  fs: LintFs,
  rootDir: string,
  options: { packlistProvider?: PacklistProvider } = {}
): Promise<WorkspaceModel> {
  const root = await loadPackage(fs, rootDir, ".", true);
  if (!root) throw new Error(`No package.json at workspace root: ${rootDir}`);

  const packagesDir = path.join(rootDir, "packages");
  let dirents: { name: string; isDirectory(): boolean }[];
  try {
    dirents = await fs.readdir(packagesDir);
  } catch {
    dirents = [];
  }
  const dirs = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  const [loaded, releaseWorkflows] = await Promise.all([
    Promise.all(dirs.map((d) => loadPackage(fs, rootDir, `packages/${d}`, false))),
    loadReleaseWorkflows(fs, rootDir)
  ]);
  const packages = loaded
    .filter((p): p is PackageInfo => p !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));

  const byName = new Map(packages.map((p) => [p.name, p]));
  const byDir = new Map<string, PackageInfo>([[root.dir, root]]);
  for (const p of packages) byDir.set(p.dir, p);

  const { shippedDirs, binTargets } = deriveShipped(root);
  const rootEntryPoints = deriveRootEntryPoints(root);
  const workspaceNames = new Set(packages.map((p) => p.name));
  const sourceImportPackages = packages.map((pkg) => ({
    dir: pkg.dir,
    sourceExclude: pkg.sourceExclude,
    workspaceNames: new Set([...workspaceNames].filter((name) => name !== pkg.name))
  }));
  const runtimePackages = packages.map((pkg) => ({
    name: pkg.name,
    dir: pkg.dir,
    sourceExclude: pkg.sourceExclude
  }));
  const partialModel = {
    root,
    packages
  };
  const shippedDistEntryFiles = [...new Set(rootEntryPoints.map((entry) => entry.target))];
  const [sourceImports, shippedDistImports, runtimeFileAssets, packageFiles] = await Promise.all([
    scanSourceImports(fs, rootDir, sourceImportPackages),
    scanImportFiles(fs, rootDir, shippedDistEntryFiles, [root, ...packages]),
    scanRuntimeFileAssets(fs, rootDir, runtimePackages),
    loadPackageFileView(options.packlistProvider ?? createNpmPacklistProvider(fs), {
      rootDir,
      model: partialModel,
      fs
    })
  ]);
  return {
    root,
    packages,
    byName,
    byDir,
    releaseWorkflows,
    shippedDirs,
    binTargets,
    sourceImports,
    shippedDistImports,
    rootEntryPoints,
    runtimeFileAssets,
    packageFiles
  };
}

/** Package dirs that some release workflow publishes (so the package reaches npm). */
export function releaseTargetDirs(model: WorkspaceModel): Set<string> {
  const dirs = new Set<string>();
  for (const wf of model.releaseWorkflows) for (const dir of wf.targetDirs) dirs.add(dir);
  return dirs;
}

/** A package genuinely reaches npm: it is a public npm package a release workflow publishes. */
export function isGenuinelyPublished(model: WorkspaceModel, pkg: PackageInfo): boolean {
  return isPublishedNpm(pkg) && releaseTargetDirs(model).has(pkg.dir);
}

function toPackageName(specifier: string): string | undefined {
  if (specifier.startsWith("node:")) return undefined;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

export function parseMetafile(meta: {
  inputs?: Record<string, unknown>;
  outputs?: Record<string, { imports?: { path?: string; external?: boolean; kind?: string }[] }>;
}): BuildView {
  const inlinedDirs = new Set<string>();
  for (const input of Object.keys(meta.inputs ?? {})) {
    const at = input.indexOf("packages/");
    if (at < 0) continue;
    const dir = packageDirOf(input.slice(at));
    if (dir) inlinedDirs.add(dir);
  }
  const externals = new Set<string>();
  for (const output of Object.values(meta.outputs ?? {})) {
    for (const imp of output.imports ?? []) {
      if (imp.external && imp.kind !== "dynamic-import" && typeof imp.path === "string") {
        const name = toPackageName(imp.path);
        if (name) externals.add(name);
      }
    }
  }
  return { inlinedDirs, externals };
}

export async function loadBuildView(fs: LintFs, rootDir: string): Promise<BuildView | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(rootDir, "dist", "metafile.json"));
  } catch {
    return undefined;
  }
  try {
    return parseMetafile(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/** All workspace packages plus the root package. */
export function allPackages(model: WorkspaceModel): PackageInfo[] {
  return [model.root, ...model.packages];
}

export function isPublishedNpm(pkg: PackageInfo): boolean {
  return pkg.ecosystem === "npm" && !pkg.private;
}

export interface DependencyEdge {
  name: string;
  spec: string;
  field: DependencyField;
}

export function dependencyEdges(pkg: PackageInfo): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  const fields: [DependencyField, Record<string, string>][] = [
    ["dependencies", pkg.dependencies],
    ["peerDependencies", pkg.peerDependencies],
    ["optionalDependencies", pkg.optionalDependencies]
  ];
  for (const [field, deps] of fields) {
    for (const [name, spec] of Object.entries(deps)) edges.push({ name, spec, field });
  }
  return edges;
}
