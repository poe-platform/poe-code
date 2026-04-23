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
  it("bundles unpublished workspace dependencies for standalone toolcraft packages", () => {
    const packagesToCheck = [
      "packages/toolcraft/package.json",
      "packages/toolcraft-openapi/package.json",
    ];

    expect(
      packagesToCheck.flatMap((relativePath) => {
        const pkg = readPackageJson(relativePath);
        return getUnbundledWorkspaceDeps(pkg).map((name) => `${relativePath}:${name}`);
      })
    ).toEqual([]);
  });

  it("records repository.directory for standalone toolcraft packages", () => {
    expect(readPackageJson("packages/toolcraft/package.json").repository?.directory).toBe(
      "packages/toolcraft"
    );
    expect(readPackageJson("packages/toolcraft-schema/package.json").repository?.directory).toBe(
      "packages/toolcraft-schema"
    );
    expect(readPackageJson("packages/toolcraft-openapi/package.json").repository?.directory).toBe(
      "packages/toolcraft-openapi"
    );
  });

  it("keeps root poe-code exports focused on root SDK and memory only", () => {
    const exportsField = readPackageJson("package.json").exports ?? {};

    expect(Object.keys(exportsField).sort()).toEqual([".", "./memory"]);
  });
});
