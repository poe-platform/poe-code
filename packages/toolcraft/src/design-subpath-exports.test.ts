import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderFileChanges } from "./design.js";
import { parse } from "./design/render-markdown.js";

const packageSourceDir = import.meta.dirname;

describe("toolcraft design flat subpath modules", () => {
  it("exposes the Markdown AST for non-terminal renderers", () => {
    expect(parse("**bold** and `code`\n\n- item").ast).toMatchObject({
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "strong", children: [{ type: "text", value: "bold" }] }, { type: "text", value: " and " }, { type: "inlineCode", value: "code" }] },
        { type: "list", ordered: false, children: [{ type: "listItem" }] }
      ]
    });
  });
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

  it("exports file-change rendering through toolcraft/design", () => {
    expect(
      renderFileChanges([{ kind: "added", path: "flows/morning.json" }], {
        format: "markdown"
      })
    ).toContain("A  flows/morning.json");
  });
});

function readDesignBridge(name: string): string {
  return fs.readFileSync(path.join(packageSourceDir, "design", `${name}.ts`), "utf8");
}
