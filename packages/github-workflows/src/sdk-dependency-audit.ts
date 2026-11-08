import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const SDK_PACKAGE_NAME = "@modelcontextprotocol/sdk";
const FORBIDDEN_DEPENDENCY_KEYS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;
const ALLOWED_DEPENDENCY_KEY = "devDependencies" as const;

type DependencyKey =
  | typeof ALLOWED_DEPENDENCY_KEY
  | (typeof FORBIDDEN_DEPENDENCY_KEYS)[number];

interface PackageJsonLike {
  name?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface AuditFileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{
    isDirectory(): boolean;
    isFile(): boolean;
  }>;
}

export interface SdkDependencyOccurrence {
  key: DependencyKey;
  version: string;
}

export interface SdkDependencyFinding {
  manifestPath: string;
  packageName?: string;
  occurrences: SdkDependencyOccurrence[];
}

export interface McpSdkDependencyAuditReport {
  packagesDir: string;
  packageJsonPaths: string[];
  findings: SdkDependencyFinding[];
  violations: SdkDependencyFinding[];
}

export interface McpSdkDependencyAuditOptions {
  packagesDir: string;
  fs?: AuditFileSystem;
}

const defaultFs: AuditFileSystem = {
  readFile,
  readdir,
  stat,
};

export async function auditMcpSdkDependencyUsage(
  options: McpSdkDependencyAuditOptions
): Promise<McpSdkDependencyAuditReport> {
  const fs = options.fs ?? defaultFs;
  const packageJsonPaths = await listPackageJsonPaths(options.packagesDir, fs);
  const findings = await Promise.all(
    packageJsonPaths.map(async (manifestPath) => inspectPackageJson(manifestPath, options.packagesDir, fs))
  );
  const filteredFindings = findings.filter(
    (finding): finding is SdkDependencyFinding => finding !== undefined
  );

  return {
    packagesDir: options.packagesDir,
    packageJsonPaths,
    findings: filteredFindings,
    violations: filteredFindings.filter(hasForbiddenSdkDependency),
  };
}

export async function assertMcpSdkIsDevDependencyOnly(
  options: McpSdkDependencyAuditOptions
): Promise<void> {
  const report = await auditMcpSdkDependencyUsage(options);

  if (report.violations.length === 0) {
    return;
  }

  throw new Error(
    report.violations
      .flatMap((finding) =>
        finding.occurrences
          .filter((occurrence) => occurrence.key !== ALLOWED_DEPENDENCY_KEY)
          .map(
            (occurrence) =>
              `${finding.manifestPath} -> ${occurrence.key}["${SDK_PACKAGE_NAME}"] must move to devDependencies.`
          )
      )
      .join("\n")
  );
}

function hasForbiddenSdkDependency(finding: SdkDependencyFinding): boolean {
  return finding.occurrences.some((occurrence) => occurrence.key !== ALLOWED_DEPENDENCY_KEY);
}

async function inspectPackageJson(
  manifestPath: string,
  packagesDir: string,
  fs: AuditFileSystem
): Promise<SdkDependencyFinding | undefined> {
  const rawManifest = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(rawManifest) as PackageJsonLike;
  const occurrences = readSdkOccurrences(manifest);

  if (occurrences.length === 0) {
    return undefined;
  }

  return {
    manifestPath: path.relative(path.dirname(packagesDir), manifestPath),
    ...(typeof manifest.name === "string" ? { packageName: manifest.name } : {}),
    occurrences,
  };
}

function readSdkOccurrences(manifest: PackageJsonLike): SdkDependencyOccurrence[] {
  const occurrences: SdkDependencyOccurrence[] = [];

  for (const key of [ALLOWED_DEPENDENCY_KEY, ...FORBIDDEN_DEPENDENCY_KEYS] satisfies DependencyKey[]) {
    const dependencies = manifest[key];
    const version = dependencies?.[SDK_PACKAGE_NAME];

    if (typeof version === "string") {
      occurrences.push({
        key,
        version,
      });
    }
  }

  return occurrences;
}

async function listPackageJsonPaths(
  rootDir: string,
  fs: AuditFileSystem
): Promise<string[]> {
  const entries = (await fs.readdir(rootDir)).sort((left, right) => left.localeCompare(right));
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(rootDir, entry);
      const entryStat = await fs.stat(entryPath);

      if (!entryStat.isDirectory() || entry === "node_modules") {
        return [];
      }

      const manifestPath = path.join(entryPath, "package.json");

      try {
        const manifestStat = await fs.stat(manifestPath);
        return manifestStat.isFile() ? [manifestPath] : [];
      } catch {
        return [];
      }
    })
  );

  return paths.flat();
}
