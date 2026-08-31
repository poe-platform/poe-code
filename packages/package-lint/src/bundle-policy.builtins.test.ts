import { createHash } from "node:crypto";
import { describe, expect, expectTypeOf, it } from "vitest";
import { findBundleIssues, type BundleMetafile } from "./bundle-policy.js";
import { publicationNodeBuiltins } from "./node-builtins.js";

function nodeMetafile(...specifiers: string[]): BundleMetafile {
  return {
    outputs: {
      "dist/index.js": {
        imports: specifiers.map((path) => ({ path, external: true, kind: "dynamic-import" }))
      }
    }
  };
}

describe("build-independent publication builtin names", () => {
  it("matches the complete checked Node24.14.0 oracle catalogue", () => {
    const names = [...publicationNodeBuiltins];
    expectTypeOf(publicationNodeBuiltins).toEqualTypeOf<ReadonlySet<string>>();
    expect(names).toHaveLength(140);
    expect(names).toEqual([...names].sort());
    expect(createHash("sha256").update(JSON.stringify(names)).digest("hex")).toBe(
      "e41e67e769e9139d7c519d69dc1f91f01f0610f44a6ade59177282f3328e7c09"
    );
  });

  it("accepts every checked catalogue name through the actual publication policy", () => {
    expect(
      findBundleIssues(
        { name: "poe-code" },
        new Set(),
        nodeMetafile(...publicationNodeBuiltins),
        new Set()
      )
    ).toEqual([]);
  });

  it("preserves the oracle's exact prefix-only names without inventing bare aliases", () => {
    const prefixOnly = [...publicationNodeBuiltins].filter(
      (name) => name.startsWith("node:") && !publicationNodeBuiltins.has(name.slice(5))
    );
    expect(prefixOnly).toEqual(["node:sea", "node:sqlite", "node:test", "node:test/reporters"]);
  });

  it.each([
    "node:sqlite",
    "node:sea",
    "inspector/promises",
    "node:inspector/promises",
    "node:test",
    "node:test/reporters",
    "fs",
    "node:fs",
    "fs/promises",
    "node:fs/promises",
    "util/types",
    "node:util/types",
    "_http_agent",
    "node:_http_agent"
  ])(
    "classifies the existing Node publication name %s without builder-version discovery",
    (name) => {
      expect(
        findBundleIssues({ name: "poe-code" }, new Set(), nodeMetafile(name), new Set())
      ).toEqual([]);
    }
  );

  it.each([
    "node:nonexistent",
    "node:sqlite/extra",
    "node:fs/unknown",
    "node:node:fs",
    "node:",
    "NODE:sqlite",
    "node:sqlite?x",
    "node:sqlite#x",
    "node:sqlite%00",
    "node:sqlite\u0000",
    "node:sqlite\n",
    "node:fs/../sqlite",
    "node:/sqlite",
    "node:sqlite/",
    "node:\\sqlite",
    "node:sqlite.js",
    "./fs",
    "/fs",
    "npm:fs",
    "nodejs:fs",
    " fs",
    ""
  ])("preserves exact invalid-external rejection for %j", (name) => {
    expect(
      findBundleIssues({ name: "poe-code" }, new Set(), nodeMetafile(name), new Set())
    ).toEqual([{ external: name, reason: "invalid-external" }]);
  });

  it.each(["sqlite", "sea", "test", "test/reporters", "fs/unknown", "@scope/pkg"])(
    "does not turn the bare dependency %s into a builtin",
    (name) => {
      expect(
        findBundleIssues({ name: "poe-code" }, new Set(), nodeMetafile(name), new Set())
      ).toEqual([{ external: name, reason: "undeclared-dependency" }]);
    }
  );

  it.each(["sqlite", "sea", "test"])(
    "retains normal declared npm dependency policy for %s",
    (name) => {
      const manifest = { name: "poe-code", dependencies: { [name]: "1.0.0" } };
      expect(findBundleIssues(manifest, new Set(), nodeMetafile(name), new Set())).toEqual([]);
    }
  );

  it("does not let dependency declarations authorise unknown node: names", () => {
    const manifest = {
      name: "poe-code",
      dependencies: { "node:nonexistent": "1.0.0" },
      optionalDependencies: { "node:sqlite/extra": "1.0.0" }
    };
    expect(
      findBundleIssues(
        manifest,
        new Set(),
        nodeMetafile("node:nonexistent", "node:sqlite/extra"),
        new Set()
      )
    ).toEqual([
      { external: "node:nonexistent", reason: "invalid-external" },
      { external: "node:sqlite/extra", reason: "invalid-external" }
    ]);
  });

  it("preserves optional dependencies, workspace rejection, deduplication and issue ordering", () => {
    const manifest = { name: "poe-code", optionalDependencies: { optional: "1.0.0" } };
    const metafile = nodeMetafile(
      "node:sqlite",
      "missing",
      "missing",
      "@scope/workspace",
      "optional"
    );
    expect(findBundleIssues(manifest, new Set(["@scope/workspace"]), metafile, new Set())).toEqual([
      { external: "@scope/workspace", reason: "workspace-not-inlined" },
      { external: "missing", reason: "undeclared-dependency" }
    ]);
  });

  it("does not exempt an unrelated root self-import", () => {
    expect(
      findBundleIssues({ name: "other-root" }, new Set(), nodeMetafile("other-root"), new Set())
    ).toEqual([{ external: "other-root", reason: "workspace-not-inlined" }]);
  });
});
