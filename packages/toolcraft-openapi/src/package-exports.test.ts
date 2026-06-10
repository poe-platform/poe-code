import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as bareEntrypoint from "./index.js";

const PACKAGE_JSON_PATH = path.resolve(import.meta.dirname, "..", "package.json");

describe("toolcraft-openapi package exports", () => {
  it("exports the mock subpath separately from the main entrypoint", () => {
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
      exports?: Record<string, { import?: string; types?: string }>;
    };

    expect(packageJson.exports?.["./mock"]).toEqual({
      types: "./dist/mock.d.ts",
      import: "./dist/mock.js"
    });
  });

  it("does not leak mockFetch into the bare entrypoint", () => {
    expect(Object.keys(bareEntrypoint)).not.toContain("mockFetch");
    expect(Object.keys(bareEntrypoint)).not.toContain("createForgeyardSpec");
  });
});
