import path from "node:path";
import { parse as parseYaml } from "yaml";
import { scanSourceImports, type SourceImportView } from "./source-imports.js";

/**
 * Minimal filesystem surface the analyzer needs. Injected so the CLI can pass
 * the real `fs/promises` and tests can pass an in-memory `memfs` volume.
 * `readFile` always returns a UTF-8 string; adapters bind the encoding.
 */
export interface LintFs {
  readFile(p: string): Promise<string>;
  readdir(p: string): Promise<{ name: string; isDirectory(): boolean }[]>;
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
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  /** Names vendored into this package's published tarball (npm `bundledDependencies`). */
  bundledDependencies: string[];
  repositoryDirectory: string | undefined;
  ecosystem: Ecosystem;
  exports: unknown;
  bin: Record<string, string>;
  files: string[];
  scripts: Record<string, string>;
}

export interface BinTarget {
  /** Bin name as declared in root `bin`, e.g. "poe-superintendent-mcp". */
  bin: string;
  /** Target path as declared, e.g. "packages/superintendent/dist/mcp.js". */
  target: string;
  /** Owning package dir, e.g. "packages/superintendent". */
  dir: string;
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

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
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

  return {
    name: typeof pkg.name === "string" ? pkg.name : relDir,
    dir: isRoot ? "." : toPosix(relDir),
    isRoot,
    private: pkg.private === true,
    version: typeof pkg.version === "string" ? pkg.version : "0.0.0",
    dependencies: toStringRecord(pkg.dependencies),
    peerDependencies: toStringRecord(pkg.peerDependencies),
    optionalDependencies: toStringRecord(pkg.optionalDependencies),
    bundledDependencies: toStringArray(pkg.bundledDependencies ?? pkg.bundleDependencies),
    repositoryDirectory:
      typeof repository?.directory === "string" ? repository.directory : undefined,
    ecosystem,
    exports: pkg.exports,
    bin: toStringRecord(pkg.bin),
    files: Array.isArray(pkg.files)
      ? (pkg.files.filter((f) => typeof f === "string") as string[])
      : [],
    scripts: toStringRecord(pkg.scripts)
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
    const activeLockstepGroups: LockstepGroup[] = [];
    const steps = Array.isArray((job as { steps?: unknown })?.steps)
      ? (job as { steps: WorkflowStep[] }).steps
      : [];
    for (const step of steps) {
      const run = typeof step.run === "string" ? step.run : "";
      const uses = typeof step.uses === "string" ? step.uses : "";
      const wd =
        typeof step["working-directory"] === "string"
          ? normalizeWorkingDir(step["working-directory"] as string)
          : undefined;

      if (run.includes("npm publish") || run.includes("semantic-release")) {
        const targetDir = wd ?? ".";
        targetDirs.add(targetDir);
        for (const group of activeLockstepGroups) {
          if (group.dirs.includes(targetDir)) group.publishedDirs.push(targetDir);
        }
      }
      if (uses.startsWith("pypa/gh-action-pypi-publish")) {
        const pd = step.with?.["packages-dir"];
        if (typeof pd === "string") targetDirs.add(dirFromArtifactPath(pd));
      }
      if (uses === "./.github/actions/prepare-lockstep-release") {
        const parsed = parseLockstepGroup(step.with?.packages);
        const validVersion = typeof step.with?.version === "string" && step.with.version.length > 0;
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
    .filter((e) => !e.isDirectory() && e.name.startsWith("release") && e.name.endsWith(".yml"))
    .map((e) => e.name)
    .sort();
  const workflows = await Promise.all(
    files.map(async (file) => parseReleaseWorkflow(file, await fs.readFile(path.join(dir, file))))
  );
  return workflows;
}

export async function loadWorkspace(fs: LintFs, rootDir: string): Promise<WorkspaceModel> {
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
  const workspaceNames = new Set(packages.map((p) => p.name));
  const sourceImports = await scanSourceImports(
    fs,
    rootDir,
    packages.map((pkg) => ({
      dir: pkg.dir,
      workspaceNames: new Set([...workspaceNames].filter((name) => name !== pkg.name))
    }))
  );
  return {
    root,
    packages,
    byName,
    byDir,
    releaseWorkflows,
    shippedDirs,
    binTargets,
    sourceImports
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
