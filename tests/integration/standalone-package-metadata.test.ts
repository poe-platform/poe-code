import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

type PackageJson = {
  bin?: Record<string, string>;
  bundledDependencies?: string[];
  bundleDependencies?: string[];
  dependencies?: Record<string, string>;
  engines?: Record<string, string>;
  exports?: Record<string, unknown>;
  files?: string[];
  name?: string;
  optionalDependencies?: Record<string, string>;
  private?: boolean;
  publishConfig?: {
    access?: string;
  };
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

  it("declares bundled toolcraft-design as optional in standalone consumers", () => {
    expect(
      readPackageJson("packages/toolcraft/package.json").optionalDependencies?.[
        "toolcraft-design"
      ]
    ).toBe("^0.0.2");
    expect(
      readPackageJson("packages/toolcraft-openapi/package.json").optionalDependencies?.[
        "toolcraft-design"
      ]
    ).toBe("^0.0.2");
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

  it("keeps toolcraft-design private and exposes it through toolcraft/design", () => {
    const designPackage = readPackageJson("packages/toolcraft-design/package.json");
    const toolcraftPackage = readPackageJson("packages/toolcraft/package.json");

    expect(designPackage).toMatchObject({
      name: "toolcraft-design",
      private: true,
      engines: { node: ">=20" },
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          import: "./dist/index.js",
        },
      },
      repository: { directory: "packages/toolcraft-design" },
      publishConfig: { access: "public" },
    });
    expect(toolcraftPackage.exports?.["./design"]).toEqual({
      types: "./dist/design.d.ts",
      import: "./dist/design.js",
    });
  });

  it("keeps root poe-code exports focused on supported SDK surfaces", () => {
    const exportsField = readPackageJson("package.json").exports ?? {};

    expect(Object.keys(exportsField).sort()).toEqual([".", "./agent", "./memory"]);
  });

  it("publishes the superintendent MCP server bin with the root package", () => {
    const rootPackage = readPackageJson("package.json");

    expect(rootPackage.bin?.["poe-superintendent-mcp"]).toBe(
      "packages/superintendent/dist/mcp.js"
    );
    expect(rootPackage.files).toContain("packages/superintendent/dist");
  });

  it("publishes root tiny test-server bins with package metadata", () => {
    const rootPackage = readPackageJson("package.json");

    expect(rootPackage.bin?.["tiny-oauth-test-server"]).toBe(
      "packages/tiny-oauth-test-server/dist/cli.js"
    );
    expect(rootPackage.bin?.["tiny-stdio-mcp-test-server"]).toBe(
      "packages/tiny-stdio-mcp-test-server/dist/cli.js"
    );
    expect(rootPackage.files).toEqual(
      expect.arrayContaining([
        "packages/tiny-oauth-test-server/package.json",
        "packages/tiny-stdio-mcp-test-server/package.json"
      ])
    );
  });
});
