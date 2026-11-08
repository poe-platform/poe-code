import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COMPLEX_DIAGRAMS_100 } from "./corpus-100.js";
import { verifySceneGeometry } from "./geometry.js";
import { layoutMermaid } from "./layout.js";
import { parseMermaid } from "./parser.js";

describe("100 super complex diagrams corpus", () => {
  it("contains exactly 100 complex diagrams across all 5 diagram families", () => {
    assert.equal(COMPLEX_DIAGRAMS_100.length, 100);
    const byCategory = new Map<string, number>();
    for (const d of COMPLEX_DIAGRAMS_100) {
      byCategory.set(d.category, (byCategory.get(d.category) ?? 0) + 1);
    }
    assert.equal(byCategory.get("flowchart"), 25);
    assert.equal(byCategory.get("sequence"), 20);
    assert.equal(byCategory.get("state"), 20);
    assert.equal(byCategory.get("class"), 20);
    assert.equal(byCategory.get("er"), 15);
  });

  it("lays out and passes all 6 geometric invariants across all 100 diagrams in dark and light themes", () => {
    for (const entry of COMPLEX_DIAGRAMS_100) {
      for (const theme of ["dark", "light"] as const) {
        const ast = parseMermaid(entry.source);
        const scene = layoutMermaid(ast, { theme });
        const report = verifySceneGeometry(scene);
        assert.deepEqual(
          report.violations,
          [],
          `${entry.id} (${entry.title}) [${theme}] had geometry violations`
        );
      }
    }
  });
});
