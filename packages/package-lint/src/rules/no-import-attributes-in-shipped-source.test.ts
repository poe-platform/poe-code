import { describe, expect, it } from "vitest";
import { makeWorkspace, pkgJson } from "../fixtures.js";
import { noImportAttributesInShippedSource } from "./no-import-attributes-in-shipped-source.js";

function releaseWorkflow(dir: string): string {
  return [
    "name: Release",
    "on:",
    `  push: { paths: ['${dir}/**'] }`,
    "jobs:",
    "  publish:",
    "    steps:",
    `      - working-directory: ${dir}`,
    "        run: npm publish --provenance --access public",
    ""
  ].join("\n");
}

const ATTRIBUTED_IMPORT = 'import schema from "./schema.json" with { type: "json" };\nexport const id = schema;\n';

describe("no-import-attributes-in-shipped-source", () => {
  it("errors when a published package ships an import attribute", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({
        name: "pub",
        repository: { directory: "packages/pub" }
      }),
      "/repo/packages/pub/src/index.ts": ATTRIBUTED_IMPORT,
      "/repo/.github/workflows/release-pub.yml": releaseWorkflow("packages/pub")
    });

    const violations = noImportAttributesInShippedSource.run(model);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      package: "pub",
      severity: "error",
      detail: { files: ["packages/pub/src/index.ts"] }
    });
  });

  it("errors when a private package bundled into a published tarball ships one", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({
        name: "pub",
        repository: { directory: "packages/pub" },
        bundledDependencies: ["priv"]
      }),
      "/repo/packages/pub/src/index.ts": 'export { id } from "priv";\n',
      "/repo/packages/priv/package.json": pkgJson({ name: "priv", private: true }),
      "/repo/packages/priv/src/index.ts": ATTRIBUTED_IMPORT,
      "/repo/.github/workflows/release-pub.yml": releaseWorkflow("packages/pub")
    });

    const violations = noImportAttributesInShippedSource.run(model);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ package: "priv", severity: "error" });
  });

  it("ignores test files and packages that never reach npm", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({
        name: "pub",
        repository: { directory: "packages/pub" }
      }),
      "/repo/packages/pub/src/index.ts": "export const ok = 1;\n",
      "/repo/packages/pub/src/index.test.ts": ATTRIBUTED_IMPORT,
      "/repo/packages/internal/package.json": pkgJson({ name: "internal", private: true }),
      "/repo/packages/internal/src/index.ts": ATTRIBUTED_IMPORT,
      "/repo/.github/workflows/release-pub.yml": releaseWorkflow("packages/pub")
    });

    expect(noImportAttributesInShippedSource.run(model)).toHaveLength(0);
  });

  it("allows plain json-free imports in shipped source", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({
        name: "pub",
        repository: { directory: "packages/pub" }
      }),
      "/repo/packages/pub/src/index.ts": 'import { x } from "./util.js";\nexport const y = x;\n',
      "/repo/packages/pub/src/util.ts": "export const x = 1;\n",
      "/repo/.github/workflows/release-pub.yml": releaseWorkflow("packages/pub")
    });

    expect(noImportAttributesInShippedSource.run(model)).toHaveLength(0);
  });
});
