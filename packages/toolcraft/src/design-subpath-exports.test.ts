import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageSourceDir = import.meta.dirname;

describe("toolcraft design flat subpath modules", () => {
  it("bridges representative design helpers through flat package subpaths", () => {
    expect(readDesignBridge("render-markdown-html")).toContain(
      'from "toolcraft-design/render-markdown-html"'
    );
    expect(readDesignBridge("render-table")).toContain('from "toolcraft-design/render-table"');
    expect(readDesignBridge("render-detail-card")).toContain(
      'from "toolcraft-design/render-detail-card"'
    );
    expect(readDesignBridge("create-dashboard")).toContain(
      'from "toolcraft-design/create-dashboard"'
    );
  });
});

function readDesignBridge(name: string): string {
  return fs.readFileSync(path.join(packageSourceDir, "design", `${name}.ts`), "utf8");
}
