import { describe, expect, it } from "vitest";
import { memLintFs, pkgJson } from "./fixtures.js";
import {
  extractRelevantImports,
  mayContainRelevantImport,
  scanSourceImports
} from "./source-imports.js";

const workspaceNames = new Set(["private-package", "@poe-code/shared"]);

describe("mayContainRelevantImport", () => {
  it("accepts source that names a workspace package", () => {
    expect(
      mayContainRelevantImport('import { value } from "private-package";\n', workspaceNames)
    ).toBe(true);
    expect(
      mayContainRelevantImport(
        'export { value } from "@poe-code/shared/testing";\n',
        workspaceNames
      )
    ).toBe(true);
  });

  it("accepts source with a parent-relative import", () => {
    expect(mayContainRelevantImport('import "../../shared/src/index.js";\n', workspaceNames)).toBe(
      true
    );
  });

  it("ignores bare workspace imports when only relative boundary checks apply", () => {
    expect(mayContainRelevantImport('import { value } from "private-package";\n', new Set())).toBe(
      false
    );
  });

  it("rejects source that cannot affect import-boundary rules", () => {
    expect(mayContainRelevantImport('import path from "node:path";\n', workspaceNames)).toBe(false);
    expect(mayContainRelevantImport('export { value } from "./value.js";\n', workspaceNames)).toBe(
      false
    );
    expect(
      mayContainRelevantImport('// import "../../shared/src/index.js"\n', workspaceNames)
    ).toBe(false);
    expect(mayContainRelevantImport('const example = "private-package";\n', workspaceNames)).toBe(
      false
    );
  });

  it("accepts relevant dynamic imports and requires", () => {
    expect(mayContainRelevantImport('await import("private-package");\n', workspaceNames)).toBe(
      true
    );
    expect(
      mayContainRelevantImport('require("../../shared/src/index.js");\n', workspaceNames)
    ).toBe(true);
  });
});

describe("extractRelevantImports", () => {
  it("uses lightweight preprocessing for ordinary import forms", () => {
    expect(
      extractRelevantImports(
        [
          'import { value } from "private-package";',
          'export { other } from "@poe-code/shared/testing";',
          'const lazy = import("private-package/lazy");',
          'const required = require("../../shared/src/index.js");'
        ].join("\n"),
        "index.ts"
      )
    ).toEqual([
      { specifier: "private-package", typeOnly: false },
      { specifier: "@poe-code/shared/testing", typeOnly: false },
      { specifier: "private-package/lazy", typeOnly: false },
      { specifier: "../../shared/src/index.js", typeOnly: false }
    ]);
  });

  it("falls back to the AST for type-only imports", () => {
    expect(
      extractRelevantImports(
        [
          'import type { A } from "private-package";',
          'export type { B } from "@poe-code/shared/testing";',
          'import { type C } from "private-package/types";',
          'import{type D}from "private-package/compact";',
          'export{type E}from "private-package/export-compact";'
        ].join("\n"),
        "index.ts"
      )
    ).toEqual([
      { specifier: "private-package", typeOnly: true },
      { specifier: "@poe-code/shared/testing", typeOnly: true },
      { specifier: "private-package/types", typeOnly: true },
      { specifier: "private-package/compact", typeOnly: true },
      { specifier: "private-package/export-compact", typeOnly: true }
    ]);
  });

  it("ignores import type queries because they are erased", () => {
    expect(
      extractRelevantImports('type Client = import("private-package").Client;\n', "index.ts")
    ).toEqual([]);
  });
});

describe("scanSourceImports", () => {
  it("uses the bulk file list hook when available", async () => {
    const baseFs = memLintFs({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/agent/package.json": pkgJson({ name: "agent" }),
      "/repo/packages/agent/src/index.ts": 'import { value } from "@poe-code/shared";'
    });
    let listFilesCalls = 0;
    const fs = {
      ...baseFs,
      async listFiles(dir: string) {
        listFilesCalls += 1;
        return baseFs.listFiles!(dir);
      },
      async readdir() {
        throw new Error("scanSourceImports should not recursively readdir when listFiles exists");
      }
    };

    const view = await scanSourceImports(fs, "/repo", [
      { dir: "packages/agent", workspaceNames: new Set(["@poe-code/shared"]) }
    ]);

    expect(listFilesCalls).toBe(1);
    expect(view.get("packages/agent")).toMatchObject([
      {
        file: "packages/agent/src/index.ts",
        specifier: "@poe-code/shared",
        packageName: "@poe-code/shared"
      }
    ]);
  });
});
