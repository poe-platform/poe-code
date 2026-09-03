import fs from "node:fs";
import path from "node:path";
import { minVersion, satisfies } from "semver";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

type PackageJson = {
  bin?: Record<string, string>;
  bundledDependencies?: string[];
  bundleDependencies?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
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
  it.each(["package.json", "packages/poe-agent/package.json"])(
    "%s requires a patched shell-quote consumer floor",
    (relativePath) => {
      const range = readPackageJson(relativePath).dependencies?.["shell-quote"];
      expect(range).toBeDefined();
      expect(satisfies(minVersion(range!)!, ">=1.9.0 <2")).toBe(true);
    }
  );

  it("ships gray-matter with its locked patched YAML parser", () => {
    const pkg = readPackageJson("package.json");
    expect(pkg.dependencies?.["gray-matter"]).toBeDefined();
    expect(pkg.bundleDependencies).toContain("gray-matter");
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
    const yaml = lock.packages["node_modules/gray-matter/node_modules/js-yaml"];
    expect(satisfies(yaml.version, ">=3.15.1 <4")).toBe(true);
    expect(yaml.inBundle).toBe(true);
  });

  it("does not pin poe-code to one 0.0.x Toolcraft release", () => {
    const dependencies = readPackageJson("package.json").dependencies;
    expect(dependencies?.toolcraft).toBe(">=0.0.51 <0.1.0");
    expect(dependencies).not.toHaveProperty("poe-code");
  });

  it("does not publish removed cloud-runtime dependencies", () => {
    expect(readPackageJson("package.json").dependencies).not.toHaveProperty("e2b");
    expect(readPackageJson("package.json").devDependencies).not.toHaveProperty(
      "@poe-code/runner-e2b"
    );
  });

  it("bundles unpublished workspace dependencies for standalone toolcraft packages", () => {
    const packagesToCheck = [
      "packages/toolcraft/package.json",
      "packages/toolcraft-openapi/package.json"
    ];

    expect(
      packagesToCheck.flatMap((relativePath) => {
        const pkg = readPackageJson(relativePath);
        return getUnbundledWorkspaceDeps(pkg).map((name) => `${relativePath}:${name}`);
      })
    ).toEqual([]);
  });

  it("uses Toolcraft's public auth-store export", () => {
    const openApiPackage = readPackageJson("packages/toolcraft-openapi/package.json");

    expect(openApiPackage.dependencies?.["auth-store"]).toBeUndefined();
    expect(openApiPackage.optionalDependencies?.["auth-store"]).toBeUndefined();
    expect(openApiPackage.bundleDependencies).not.toContain("auth-store");
  });

  it("declares bundled toolcraft-design as optional in standalone consumers", () => {
    expect(
      readPackageJson("packages/toolcraft/package.json").optionalDependencies?.["toolcraft-design"]
    ).toBe("*");
    expect(
      readPackageJson("packages/toolcraft-openapi/package.json").optionalDependencies?.[
        "toolcraft-design"
      ]
    ).toBe("*");
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

  it("bundles private workspace packages behind toolcraft exports", () => {
    const designPackage = readPackageJson("packages/toolcraft-design/package.json");
    const toolcraftPackage = readPackageJson("packages/toolcraft/package.json");

    expect(designPackage).toMatchObject({
      name: "toolcraft-design",
      engines: { node: ">=18.18" },
      files: ["dist", "LICENSE"],
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          import: "./dist/index.js"
        }
      }
    });
    const bundledExports = [
      ["agent-defs", "agent-defs"],
      ["agent-mcp-config", "agent-mcp-config"],
      ["auth-store", "auth-store"],
      ["config-mutations", "config-mutations"],
      ["toolcraft-design", "design"],
      ["frontmatter", "frontmatter"],
      ["process-runner", "process-runner"],
      ["tiny-mcp-client", "tiny-mcp-client"]
    ] as const;

    for (const [packageDir, exportName] of bundledExports) {
      expect(readPackageJson(`packages/${packageDir}/package.json`).private).toBe(true);
      expect(toolcraftPackage.exports?.[`./${exportName}`]).toEqual({
        types: `./dist/${exportName}.d.ts`,
        import: `./dist/${exportName}.js`
      });
    }

    // Bundled for the human-in-loop runtime only — reachable through
    // toolcraft/human-in-loop, never as their own subpath exports.
    for (const packageDir of ["agent-human-in-loop", "task-list"]) {
      expect(readPackageJson(`packages/${packageDir}/package.json`).private).toBe(true);
    }
    expect(toolcraftPackage.exports?.["./agent-human-in-loop"]).toBeUndefined();
    expect(toolcraftPackage.exports?.["./task-list"]).toBeUndefined();
    expect(toolcraftPackage.exports?.["./human-in-loop"]).toEqual({
      types: "./dist/human-in-loop/index.d.ts",
      import: "./dist/human-in-loop/index.js"
    });
  });

  it("inlines private mcp-oauth into tiny-mcp-client", () => {
    const oauthPackage = readPackageJson("packages/mcp-oauth/package.json");
    const clientPackage = readPackageJson("packages/tiny-mcp-client/package.json");
    const toolcraftPackage = readPackageJson("packages/toolcraft/package.json");

    expect(oauthPackage.private).toBe(true);
    expect(oauthPackage.publishConfig).toBeUndefined();
    expect(clientPackage.dependencies?.["mcp-oauth"]).toBeUndefined();
    expect(clientPackage.devDependencies?.["mcp-oauth"]).toBe("*");
    expect(toolcraftPackage.bundleDependencies).not.toContain("mcp-oauth");
    expect(toolcraftPackage.optionalDependencies?.["mcp-oauth"]).toBeUndefined();
  });

  it("keeps root poe-code exports focused on supported SDK surfaces", () => {
    const exportsField = readPackageJson("package.json").exports ?? {};

    expect(Object.keys(exportsField).sort()).toEqual([
      ".",
      "./agent",
      "./config",
      "./config/testing",
      "./credentials",
      "./memory",
      "./safe-bash",
      "./safe-bash/browser",
      "./safe-bash/commands/apply-patch",
      "./safe-bash/commands/archive",
      "./safe-bash/commands/column",
      "./safe-bash/commands/du",
      "./safe-bash/commands/expr",
      "./safe-bash/commands/file",
      "./safe-bash/commands/grep-aliases",
      "./safe-bash/commands/html-to-markdown",
      "./safe-bash/commands/metadata",
      "./safe-bash/commands/network",
      "./safe-bash/commands/node",
      "./safe-bash/commands/split",
      "./safe-bash/commands/stream-format",
      "./safe-bash/commands/stream-inspection",
      "./safe-bash/commands/table-text",
      "./safe-bash/commands/time-env",
      "./safe-bash/commands/timeout",
      "./safe-bash/commands/tree",
      "./safe-bash/commands/which",
      "./safe-bash/contracts",
      "./safe-bash/contracts/*",
      "./safe-bash/fs/mount",
      "./safe-bash/fs/overlay",
      "./safe-bash/fs/readonly",
      "./safe-bash/fs/s3",
      "./safe-bash/fs/s3/http",
      "./safe-bash/fs/webdav",
      "./safe-fs",
      "./safe-fs/core",
      "./safe-fs/node",
      "./safe-js",
      "./safe-js/cli",
      "./safe-js/core",
      "./safejs",
      "./safejs/cli",
      "./safejs/core",
      "./skills"
    ]);
  });

  it("publishes the superintendent MCP server bin with the root package", () => {
    const rootPackage = readPackageJson("package.json");

    expect(rootPackage.bin?.["poe-superintendent-mcp"]).toBe("packages/superintendent/dist/mcp.js");
    expect(rootPackage.files).toContain("packages/superintendent/dist");
  });

  it("publishes only the supported bins", () => {
    const rootPackage = readPackageJson("package.json");

    expect(Object.keys(rootPackage.bin ?? {}).sort()).toEqual([
      "poe",
      "poe-agent",
      "poe-code",
      "poe-safe-js",
      "poe-safejs",
      "poe-superintendent-mcp"
    ]);
  });

  it("does not publish a generic safe-bash MCP server", () => {
    const rootPackage = readPackageJson("package.json");

    expect(rootPackage.exports?.["./safe-bash-mcp"]).toBeUndefined();
    expect(rootPackage.bin?.["poe-safe-bash-mcp"]).toBeUndefined();
    expect(rootPackage.files).not.toContain("packages/safe-bash-mcp/dist");
    expect(rootPackage.devDependencies?.["safe-bash-mcp"]).toBeUndefined();
  });

  it("keeps dev-only tiny test servers out of the published package", () => {
    const rootPackage = readPackageJson("package.json");

    expect(rootPackage.files).not.toEqual(
      expect.arrayContaining([
        "packages/tiny-oauth-test-server/package.json",
        "packages/tiny-oauth-test-server/dist",
        "packages/tiny-stdio-mcp-test-server/package.json",
        "packages/tiny-stdio-mcp-test-server/dist"
      ])
    );
    expect(rootPackage.devDependencies?.["tiny-oauth-test-server"]).toBe("*");
    expect(rootPackage.devDependencies?.["tiny-stdio-mcp-test-server"]).toBe("*");
  });

  it("brands the sandboxed JavaScript package as SafeJS", () => {
    const rootPackage = readPackageJson("package.json");
    const safejsPackage = readPackageJson("packages/safe-js/package.json");

    expect(rootPackage.devDependencies?.["@poe-code/safe-js"]).toBe("*");
    expect(rootPackage.devDependencies?.["@poe-code/agent-script"]).toBeUndefined();
    expect(rootPackage.files).toContain("packages/safe-js/dist");
    expect(rootPackage.files).not.toContain("packages/agent-script/dist");
    expect(rootPackage.bin?.["poe-safejs"]).toBe("packages/safe-js/dist/cli.js");
    for (const [subpath, entrypoint] of [
      ["./safejs", "index"],
      ["./safejs/core", "core"],
      ["./safejs/cli", "cli"]
    ]) {
      expect(rootPackage.exports?.[subpath]).toEqual({
        types: {
          browser: "./packages/safe-fs/dist/node-unavailable.d.ts",
          default: `./packages/safe-js/dist/${entrypoint}.d.ts`
        },
        browser: null,
        import: `./packages/safe-js/dist/${entrypoint}.js`
      });
    }
    expect(safejsPackage).toMatchObject({
      name: "@poe-code/safe-js",
      bin: {
        "poe-safejs": "dist/cli.js",
        "poe-safe-js": "dist/cli.js"
      }
    });
  });

  it("brands the maestro package without the agent prefix", () => {
    const rootPackage = readPackageJson("package.json");
    const maestroPackage = readPackageJson("packages/maestro/package.json");

    expect(rootPackage.devDependencies?.["@poe-code/maestro"]).toBe("*");
    expect(rootPackage.devDependencies?.["@poe-code/agent-maestro"]).toBeUndefined();
    expect(rootPackage.files).toContain("packages/maestro/dist");
    expect(rootPackage.files).not.toContain("packages/agent-maestro/dist");
    expect(maestroPackage).toMatchObject({
      name: "@poe-code/maestro"
    });
  });

  it("keeps canonical and legacy SafeJS routes identical and Node-only", () => {
    const rootPackage = readPackageJson("package.json");
    for (const [suffix, entrypoint] of [
      ["", "index"],
      ["/core", "core"],
      ["/cli", "cli"]
    ]) {
      expect(rootPackage.exports?.[`./safe-js${suffix}`]).toEqual({
        types: {
          browser: "./packages/safe-fs/dist/node-unavailable.d.ts",
          default: `./packages/safe-js/dist/${entrypoint}.d.ts`
        },
        browser: null,
        import: `./packages/safe-js/dist/${entrypoint}.js`
      });
      expect(rootPackage.exports?.[`./safejs${suffix}`]).toEqual(
        rootPackage.exports?.[`./safe-js${suffix}`]
      );
    }
    expect(rootPackage.bin?.["poe-safe-js"]).toBe("packages/safe-js/dist/cli.js");
    expect(rootPackage.bin?.["poe-safejs"]).toBe(rootPackage.bin?.["poe-safe-js"]);
    expect(rootPackage.files).not.toContain("packages/safejs/dist");
    expect(rootPackage.devDependencies?.["@poe-code/safejs"]).toBeUndefined();
  });
});
