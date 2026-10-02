import { describe, expect, it } from "vitest";
import { memLintFs, pkgJson } from "./fixtures.js";
import { scanPortableRuntime } from "./portable-runtime.js";

function fixture(source: string, extra: Record<string, string> = {}) {
  return memLintFs({
    "/repo/package.json": pkgJson({ name: "root", private: true }),
    "/repo/packages/safe-bash-command-example/package.json": pkgJson({ name: "safe-bash-command-example", private: true,
      exports: { ".": { workerd: "./dist/index.js", browser: "./dist/index.js", import: "./dist/node.js" }, "./host": { workerd: null, browser: null, node: "./dist/host.js" } } }),
    "/repo/packages/safe-bash-command-example/dist/index.js": source,
    "/repo/packages/safe-bash-command-example/dist/node.js": 'import "node:fs";',
    "/repo/packages/safe-bash-command-example/dist/host.js": 'import "node:child_process";',
    ...extra,
  });
}

describe("portable runtime dependency policy", () => {
  it.each(["node:fs", "fs/promises", "node:path", "buffer", "graceful-fs", "fs-extra"])("rejects runtime dependency %s", async name => {
    const issues = await scanPortableRuntime(fixture(`import ${JSON.stringify(name)};`), "/repo");
    expect(issues).toContainEqual(expect.objectContaining({ reason: "forbidden-dependency", specifier: name }));
  });
  it.each(['Buffer.from("x")', 'globalThis.Buffer.byteLength("x")', 'globalThis["Buffer"].from("x")'])("rejects ambient Buffer: %s", async source => {
    expect(await scanPortableRuntime(fixture(source), "/repo")).toContainEqual(expect.objectContaining({ reason: "ambient-buffer" }));
  });
  it("ignores strings, property names and locally bound Buffer implementations", async () => {
    const source = 'const text = "Buffer.from node:fs"; const object = { Buffer: 1 }; function encode(Buffer) { return Buffer.from(text); }';
    expect(await scanPortableRuntime(fixture(source), "/repo")).toEqual([]);
  });
  it("finds ambient Buffer inside deeply nested minified expressions", async () => {
    const source = 'export const value = ' + '0+'.repeat(15000) + 'Buffer.from("x");';
    expect(await scanPortableRuntime(fixture(source), "/repo")).toEqual([
      expect.objectContaining({ reason: "ambient-buffer" })
    ]);
  });
  it("follows transitive relative imports and stops cycles", async () => {
    const fs = fixture('export * from "./nested.js";', {
      "/repo/packages/safe-bash-command-example/dist/nested.js": 'import "./index.js"; import "node:fs";',
    });
    expect(await scanPortableRuntime(fs, "/repo")).toContainEqual(expect.objectContaining({ file: "packages/safe-bash-command-example/dist/nested.js", specifier: "node:fs" }));
  });
  it("selects portable package imports and excludes explicit Node host routes", async () => {
    const fs = fixture('import "#platform";', {
      "/repo/packages/safe-bash-command-example/package.json": pkgJson({ name: "safe-bash-command-example", private: true,
        exports: { ".": { workerd: "./dist/index.js", browser: "./dist/index.js" }, "./node": { workerd: null, browser: null, node: "./dist/node.js" } },
        imports: { "#platform": { workerd: "./dist/web.js", browser: "./dist/web.js", default: "./dist/node.js" } } }),
      "/repo/packages/safe-bash-command-example/dist/web.js": 'export const value = new Uint8Array();',
    });
    expect(await scanPortableRuntime(fs, "/repo")).toEqual([]);
  });
  it("checks first-party transitive engines and reports missing runtime imports", async () => {
    const fs = fixture('import "safe-bash-example-engine"; import "#missing";', {
      "/repo/packages/safe-bash-example-engine/package.json": pkgJson({ name: "safe-bash-example-engine", private: true, exports: { ".": { import: "./dist/index.js" } } }),
      "/repo/packages/safe-bash-example-engine/dist/index.js": 'Buffer.alloc(1);',
    });
    const issues = await scanPortableRuntime(fs, "/repo");
    expect(issues).toContainEqual(expect.objectContaining({ reason: "ambient-buffer" }));
    expect(issues).toContainEqual(expect.objectContaining({ reason: "unresolved-import", specifier: "#missing" }));
  });
});

it("checks wildcard portable exports", async () => {
  const fs = fixture('export const value = 1;', {
    "/repo/packages/safe-bash-command-example/package.json": pkgJson({ name: "safe-bash-command-example", private: true,
      exports: { "./*": { workerd: "./dist/*.js", browser: "./dist/*.js" }, "./host": { workerd: null, browser: null, node: "./dist/host.js" }, "./node": { workerd: null, browser: null, node: "./dist/node.js" } } }),
    "/repo/packages/safe-bash-command-example/dist/nested/bad.js": 'import "node:fs";',
  });
  expect(await scanPortableRuntime(fs, "/repo")).toContainEqual(expect.objectContaining({ file: "packages/safe-bash-command-example/dist/nested/bad.js", specifier: "node:fs" }));
});

it("leaves explicitly optional host peers outside the owned portable artifact graph", async () => {
  const fs = fixture('export const connect = () => import("host-sdk");', {
    "/repo/packages/safe-bash-command-example/package.json": pkgJson({ name: "safe-bash-command-example", private: true,
      exports: { ".": { workerd: "./dist/index.js", browser: "./dist/index.js" } },
      peerDependencies: { "host-sdk": "1.0.0" }, peerDependenciesMeta: { "host-sdk": { optional: true } } }),
    "/repo/node_modules/host-sdk/package.json": pkgJson({ name: "host-sdk", main: "index.js" }),
    "/repo/node_modules/host-sdk/index.js": 'import "node:async_hooks";',
  });
  expect(await scanPortableRuntime(fs, "/repo")).toEqual([]);
});

it("resolves extensionless portable dependency modules", async () => {
  const fs = fixture('import "codec";', {
    "/repo/node_modules/codec/package.json": pkgJson({ name: "codec", module: "index.js" }),
    "/repo/node_modules/codec/index.js": 'export * from "./codec";',
    "/repo/node_modules/codec/codec.js": 'export const encode = value => value;',
  });
  expect(await scanPortableRuntime(fs, "/repo")).toEqual([]);
});

it("rejects source-level ambient Buffer even if a build injects a local shim", async () => {
  const fs = fixture('const Buffer = { from: value => value }; Buffer.from("x");', {
    "/repo/packages/safe-bash-command-example/src/index.ts": 'export const bytes = Buffer.from("x");',
  });
  expect(await scanPortableRuntime(fs, "/repo")).toContainEqual(expect.objectContaining({ file: "packages/safe-bash-command-example/src/index.ts", reason: "ambient-buffer" }));
});

it("uses the owning workspace imports when a root export crosses package boundaries", async () => {
  const fs = fixture('import "root/engine";', {
    "/repo/package.json": pkgJson({ name: "root", exports: { "./engine": "./packages/safe-js/dist/index.js" } }),
    "/repo/packages/safe-js/package.json": pkgJson({ name: "@poe-code/safe-js", exports: { ".": "./dist/index.js" }, imports: { "#platform": { workerd: "./dist/web.js", browser: "./dist/web.js" } } }),
    "/repo/packages/safe-js/dist/index.js": 'import "#platform";',
    "/repo/packages/safe-js/dist/web.js": 'export const runtime = "web";',
  });
  expect(await scanPortableRuntime(fs, "/repo")).toEqual([]);
});

it("resolves public safe library identities to their workspace implementations", async () => {
  const fs = fixture('import "@poe-platform/safe-fs/core";', {
    "/repo/packages/safe-fs/package.json": pkgJson({ name: "@poe-code/safe-fs", exports: { "./core": "./dist/core.js" } }),
    "/repo/packages/safe-fs/dist/core.js": 'import "node:fs";',
  });
  const issues = await scanPortableRuntime(fs, "/repo");
  expect(issues).toEqual([expect.objectContaining({ reason: "forbidden-dependency", specifier: "node:fs" })]);
});

it("admits native Cloudflare modules only through a workerd export", async () => {
  const fs = fixture('import "cloudflare:workers";', {
    "/repo/packages/safe-bash-command-example/package.json": pkgJson({ name: "safe-bash-command-example", exports: { ".": { workerd: "./dist/index.js", browser: null } } }),
  });
  expect(await scanPortableRuntime(fs, "/repo")).toEqual([]);
});
