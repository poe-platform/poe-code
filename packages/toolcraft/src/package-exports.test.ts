import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGE_JSON_PATH = path.resolve(import.meta.dirname, "..", "package.json");

describe("toolcraft package exports", () => {
  it("exports the bundled design system entrypoint", () => {
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
      exports?: Record<string, { import?: string; types?: string }>;
    };

    expect(packageJson.exports?.["./design"]).toEqual({
      types: "./dist/design.d.ts",
      import: "./dist/design.js",
    });
  });

  it("exports flat bundled design system subpaths", () => {
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
      exports?: Record<string, { import?: string; types?: string }>;
    };

    expect(packageJson.exports?.["./design/*"]).toEqual({
      types: "./dist/design/*.d.ts",
      import: "./dist/design/*.js",
    });
  });

  it("exports the human-in-loop entrypoint", () => {
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
      exports?: Record<string, { import?: string; types?: string }>;
    };

    expect(packageJson.exports?.["./human-in-loop"]).toEqual({
      types: "./dist/human-in-loop/index.d.ts",
      import: "./dist/human-in-loop/index.js",
    });
  });

  it("exports the source snippet entrypoint", () => {
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
      exports?: Record<string, { import?: string; types?: string }>;
    };

    expect(packageJson.exports?.["./source-snippet"]).toEqual({
      types: "./dist/source-snippet.d.ts",
      import: "./dist/source-snippet.js",
    });
  });
});
