import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

type PackageJson = {
  bundledDependencies?: string[];
  bundleDependencies?: string[];
  dependencies?: Record<string, string>;
  exports?: Record<string, unknown>;
  repository?: {
    directory?: string;
  };
};

function readPackageJson(relativePath: string): PackageJson {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8")) as PackageJson;
}

function getUnbundledWorkspaceDeps(pkg: PackageJson): string[] {
  const bundled = new Set([...(pkg.bundledDependencies ?? []), ...(pkg.bundleDependencies ?? [])]);
  return Object.keys(pkg.dependencies ?? {}).filter(
    (name) => name.startsWith("@poe-code/") && !bundled.has(name)
  );
}

describe("standalone package publish metadata", () => {
  it("bundles unpublished workspace dependencies for standalone agent-kit packages", () => {
    const packagesToCheck = [
      "packages/agent-kit/package.json",
      "packages/agent-kit-openapi/package.json",
    ];

    expect(
      packagesToCheck.flatMap((relativePath) => {
        const pkg = readPackageJson(relativePath);
        return getUnbundledWorkspaceDeps(pkg).map((name) => `${relativePath}:${name}`);
      })
    ).toEqual([]);
  });

  it("records repository.directory for standalone agent-kit packages", () => {
    expect(readPackageJson("packages/agent-kit/package.json").repository?.directory).toBe(
      "packages/agent-kit"
    );
    expect(readPackageJson("packages/agent-kit-schema/package.json").repository?.directory).toBe(
      "packages/agent-kit-schema"
    );
    expect(readPackageJson("packages/agent-kit-openapi/package.json").repository?.directory).toBe(
      "packages/agent-kit-openapi"
    );
  });

  it("keeps root poe-code exports focused on root SDK and memory only", () => {
    const exportsField = readPackageJson("package.json").exports ?? {};

    expect(Object.keys(exportsField).sort()).toEqual([".", "./memory"]);
  });
});
