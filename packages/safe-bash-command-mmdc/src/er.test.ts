import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  layoutMermaid,
  parseMermaid,
  renderMermaidPng,
  renderMermaidSvg,
  verifySceneGeometry
} from "./index.js";

export const ER_FIXTURES: Record<string, string> = {
  "er-entities-attributes": `erDiagram
    CUSTOMER {
        string id PK
        string email UK
        string full_name
    }
    ORDER {
        string id PK
        string customer_id FK
        string status
    }
    CUSTOMER ||--o{ ORDER : places`,
  "er-crows-foot-cardinalities-labels": `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    ORDER |o..|| INVOICE : generates
    PRODUCT }o--o{ TAG : categorized_by`
};

describe("erDiagram parser, layout, and geometry invariants", () => {
  for (const [name, source] of Object.entries(ER_FIXTURES)) {
    it(`parses, lays out, and satisfies all geometric invariants for ${name}`, () => {
      const doc = parseMermaid(source);
      assert.equal(doc.family, "er");
      for (const mode of ["light", "dark"] as const) {
        const scene = layoutMermaid(doc, { theme: mode });
        const check = verifySceneGeometry(scene);
        assert.equal(
          check.ok,
          true,
          `Geometry violations for ${name} (${mode}): ${check.violations.join("; ")}`
        );
        const svgRes = renderMermaidSvg(source, { theme: mode });
        assert.ok(svgRes.svg.includes("<svg"));
        const pngRes = renderMermaidPng(source, { theme: mode, scale: 2 });
        assert.ok(pngRes.png.byteLength > 100);
      }
    });
  }
});
