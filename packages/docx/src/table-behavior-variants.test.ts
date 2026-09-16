import { describe, expect, it } from "vitest";
import { editMergedTable } from "./table-merge.js";
import { readDocumentArchive } from "./admission.js";
import { ModelStore } from "./model-store.js";
import { modelContext } from "./model-context.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { Length, WD_STYLE_TYPE, WD_TABLE_ALIGNMENT, WD_TABLE_DIRECTION, WD_CELL_VERTICAL_ALIGNMENT, WD_ROW_HEIGHT_RULE } from "./formatting-values.js";

async function open(body: string) {
  const store = new ModelStore(await readDocumentArchive(await textFixture(body), textContext), modelContext(textContext), "/word/document.xml");
  const node = store.xml(store.mainPart).root.children[0]!.children.find(n => n.localName === "tbl")!;
  return { store, table: store.table(store.ref(store.mainPart, node)) };
}
const paragraph = (text = "") => text ? `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` : "<w:p/>";
const cell = (text = "", span = 1, vertical = "") => `<w:tc><w:tcPr>${span === 1 ? "" : `<w:gridSpan w:val="${span}"/>`}${vertical ? `<w:vMerge w:val="${vertical}"/>` : ""}</w:tcPr>${paragraph(text)}</w:tc>`;
const rectangle = (rows: string[], columns = 3) => `<w:tbl><w:tblGrid>${"<w:gridCol/>".repeat(columns)}</w:tblGrid>${rows.map(row => `<w:tr>${row}</w:tr>`).join("")}</w:tbl>`;
interface PropertyBoundary { label: string; body: string; target: string; property: string; expected: number | string | boolean | null; write: boolean }
const propertyBoundaries: PropertyBoundary[] = [
  {
    "label": "table alignment boundary 78",
    "body": "<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "alignment",
    "expected": null,
    "write": false
  },
  {
    "label": "table alignment boundary 79",
    "body": "<w:tbl><w:tblPr><w:jc w:val=\"center\"></w:jc></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "alignment",
    "expected": "CENTER",
    "write": false
  },
  {
    "label": "table alignment boundary 80",
    "body": "<w:tbl><w:tblPr><w:jc w:val=\"right\"></w:jc></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "alignment",
    "expected": "RIGHT",
    "write": false
  },
  {
    "label": "table alignment boundary 81",
    "body": "<w:tbl><w:tblPr><w:jc w:val=\"left\"></w:jc></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "alignment",
    "expected": "LEFT",
    "write": false
  },
  {
    "label": "table alignment boundary 82",
    "body": "<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "alignment",
    "expected": "LEFT",
    "write": true
  },
  {
    "label": "table alignment boundary 83",
    "body": "<w:tbl><w:tblPr><w:jc w:val=\"left\"></w:jc></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "alignment",
    "expected": "RIGHT",
    "write": true
  },
  {
    "label": "table alignment boundary 84",
    "body": "<w:tbl><w:tblPr><w:jc w:val=\"right\"></w:jc></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "alignment",
    "expected": null,
    "write": true
  },
  {
    "label": "table autofit boundary 85",
    "body": "<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "autofit",
    "expected": true,
    "write": false
  },
  {
    "label": "table autofit boundary 86",
    "body": "<w:tbl><w:tblPr><w:tblLayout></w:tblLayout></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "autofit",
    "expected": true,
    "write": false
  },
  {
    "label": "table autofit boundary 87",
    "body": "<w:tbl><w:tblPr><w:tblLayout w:type=\"autofit\"></w:tblLayout></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "autofit",
    "expected": true,
    "write": false
  },
  {
    "label": "table autofit boundary 88",
    "body": "<w:tbl><w:tblPr><w:tblLayout w:type=\"fixed\"></w:tblLayout></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "autofit",
    "expected": false,
    "write": false
  },
  {
    "label": "table autofit boundary 89",
    "body": "<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "autofit",
    "expected": true,
    "write": true
  },
  {
    "label": "table autofit boundary 90",
    "body": "<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "autofit",
    "expected": false,
    "write": true
  },
  {
    "label": "table autofit boundary 91",
    "body": "<w:tbl><w:tblPr><w:tblLayout w:type=\"fixed\"></w:tblLayout></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "autofit",
    "expected": true,
    "write": true
  },
  {
    "label": "table autofit boundary 92",
    "body": "<w:tbl><w:tblPr><w:tblLayout w:type=\"autofit\"></w:tblLayout></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "autofit",
    "expected": false,
    "write": true
  },
  {
    "label": "table table_direction boundary 94",
    "body": "<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "table_direction",
    "expected": null,
    "write": false
  },
  {
    "label": "table table_direction boundary 95",
    "body": "<w:tbl><w:tblPr><w:bidiVisual></w:bidiVisual></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "table_direction",
    "expected": "RTL",
    "write": false
  },
  {
    "label": "table table_direction boundary 96",
    "body": "<w:tbl><w:tblPr><w:bidiVisual w:val=\"0\"></w:bidiVisual></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "table_direction",
    "expected": "LTR",
    "write": false
  },
  {
    "label": "table table_direction boundary 97",
    "body": "<w:tbl><w:tblPr><w:bidiVisual w:val=\"on\"></w:bidiVisual></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "table_direction",
    "expected": "RTL",
    "write": false
  },
  {
    "label": "table table_direction boundary 98",
    "body": "<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "table_direction",
    "expected": "RTL",
    "write": true
  },
  {
    "label": "table table_direction boundary 99",
    "body": "<w:tbl><w:tblPr><w:bidiVisual></w:bidiVisual></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "table_direction",
    "expected": "LTR",
    "write": true
  },
  {
    "label": "table table_direction boundary 100",
    "body": "<w:tbl><w:tblPr><w:bidiVisual w:val=\"0\"></w:bidiVisual></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "table_direction",
    "expected": "RTL",
    "write": true
  },
  {
    "label": "table table_direction boundary 101",
    "body": "<w:tbl><w:tblPr><w:bidiVisual w:val=\"1\"></w:bidiVisual></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "table",
    "property": "table_direction",
    "expected": null,
    "write": true
  },
  {
    "label": "cell grid_span boundary 112",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc></w:tc></w:tr></w:tbl>",
    "target": "cell",
    "property": "grid_span",
    "expected": 1,
    "write": false
  },
  {
    "label": "cell grid_span boundary 113",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr></w:tcPr></w:tc></w:tr></w:tbl>",
    "target": "cell",
    "property": "grid_span",
    "expected": 1,
    "write": false
  },
  {
    "label": "cell grid_span boundary 114",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val=\"1\"></w:gridSpan></w:tcPr></w:tc></w:tr></w:tbl>",
    "target": "cell",
    "property": "grid_span",
    "expected": 1,
    "write": false
  },
  {
    "label": "cell grid_span boundary 115",
    "body": "<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val=\"4\"></w:gridSpan></w:tcPr></w:tc></w:tr></w:tbl>",
    "target": "cell",
    "property": "grid_span",
    "expected": 4,
    "write": false
  },
  {
    "label": "cell vertical_alignment boundary 124",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc></w:tc></w:tr></w:tbl>",
    "target": "cell",
    "property": "vertical_alignment",
    "expected": null,
    "write": false
  },
  {
    "label": "cell vertical_alignment boundary 125",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr></w:tcPr></w:tc></w:tr></w:tbl>",
    "target": "cell",
    "property": "vertical_alignment",
    "expected": null,
    "write": false
  },
  {
    "label": "cell vertical_alignment boundary 126",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:vAlign w:val=\"bottom\"></w:vAlign></w:tcPr></w:tc></w:tr></w:tbl>",
    "target": "cell",
    "property": "vertical_alignment",
    "expected": "BOTTOM",
    "write": false
  },
  {
    "label": "cell vertical_alignment boundary 127",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:vAlign w:val=\"top\"></w:vAlign></w:tcPr></w:tc></w:tr></w:tbl>",
    "target": "cell",
    "property": "vertical_alignment",
    "expected": "TOP",
    "write": false
  },
  {
    "label": "cell vertical_alignment boundary 128",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc></w:tc></w:tr></w:tbl>",
    "target": "cell",
    "property": "vertical_alignment",
    "expected": "TOP",
    "write": true
  },
  {
    "label": "cell vertical_alignment boundary 129",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr></w:tcPr></w:tc></w:tr></w:tbl>",
    "target": "cell",
    "property": "vertical_alignment",
    "expected": "CENTER",
    "write": true
  },
  {
    "label": "cell vertical_alignment boundary 130",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:vAlign w:val=\"center\"></w:vAlign></w:tcPr></w:tc></w:tr></w:tbl>",
    "target": "cell",
    "property": "vertical_alignment",
    "expected": "BOTTOM",
    "write": true
  },
  {
    "label": "cell vertical_alignment boundary 131",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:vAlign w:val=\"center\"></w:vAlign></w:tcPr></w:tc></w:tr></w:tbl>",
    "target": "cell",
    "property": "vertical_alignment",
    "expected": null,
    "write": true
  },
  {
    "label": "cell vertical_alignment boundary 132",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc></w:tc></w:tr></w:tbl>",
    "target": "cell",
    "property": "vertical_alignment",
    "expected": null,
    "write": true
  },
  {
    "label": "cell vertical_alignment boundary 133",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr></w:tcPr></w:tc></w:tr></w:tbl>",
    "target": "cell",
    "property": "vertical_alignment",
    "expected": null,
    "write": true
  },
  {
    "label": "cell width boundary 134",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc></w:tc></w:tr></w:tbl>",
    "target": "cell",
    "property": "width",
    "expected": null,
    "write": false
  },
  {
    "label": "cell width boundary 135",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr></w:tcPr></w:tc></w:tr></w:tbl>",
    "target": "cell",
    "property": "width",
    "expected": null,
    "write": false
  },
  {
    "label": "cell width boundary 136",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w=\"25%\" w:type=\"pct\"></w:tcW></w:tcPr></w:tc></w:tr></w:tbl>",
    "target": "cell",
    "property": "width",
    "expected": null,
    "write": false
  },
  {
    "label": "cell width boundary 137",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w=\"1440\" w:type=\"dxa\"></w:tcW></w:tcPr></w:tc></w:tr></w:tbl>",
    "target": "cell",
    "property": "width",
    "expected": 914400,
    "write": false
  },
  {
    "label": "cell width boundary 138",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc></w:tc></w:tr></w:tbl>",
    "target": "cell",
    "property": "width",
    "expected": 914400,
    "write": true
  },
  {
    "label": "cell width boundary 139",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w=\"25%\" w:type=\"pct\"></w:tcW></w:tcPr></w:tc></w:tr></w:tbl>",
    "target": "cell",
    "property": "width",
    "expected": 1828800,
    "write": true
  },
  {
    "label": "column width boundary 153",
    "body": "<w:tbl><w:tblGrid><w:gridCol w:w=\"4242\"></w:gridCol></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "column",
    "property": "width",
    "expected": 2693670,
    "write": false
  },
  {
    "label": "column width boundary 154",
    "body": "<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"></w:gridCol></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "column",
    "property": "width",
    "expected": 914400,
    "write": false
  },
  {
    "label": "column width boundary 155",
    "body": "<w:tbl><w:tblGrid><w:gridCol w:w=\"2.54cm\"></w:gridCol></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "column",
    "property": "width",
    "expected": 914400,
    "write": false
  },
  {
    "label": "column width boundary 156",
    "body": "<w:tbl><w:tblGrid><w:gridCol w:w=\"54mm\"></w:gridCol></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "column",
    "property": "width",
    "expected": 1944000,
    "write": false
  },
  {
    "label": "column width boundary 157",
    "body": "<w:tbl><w:tblGrid><w:gridCol w:w=\"12.5pt\"></w:gridCol></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "column",
    "property": "width",
    "expected": 158750,
    "write": false
  },
  {
    "label": "column width boundary 158",
    "body": "<w:tbl><w:tblGrid><w:gridCol></w:gridCol></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "column",
    "property": "width",
    "expected": null,
    "write": false
  },
  {
    "label": "column width boundary 159",
    "body": "<w:tbl><w:tblGrid><w:gridCol></w:gridCol></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "column",
    "property": "width",
    "expected": 914400,
    "write": true
  },
  {
    "label": "column width boundary 160",
    "body": "<w:tbl><w:tblGrid><w:gridCol w:w=\"4242\"></w:gridCol></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "column",
    "property": "width",
    "expected": 457200,
    "write": true
  },
  {
    "label": "column width boundary 161",
    "body": "<w:tbl><w:tblGrid><w:gridCol w:w=\"4242\"></w:gridCol></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "column",
    "property": "width",
    "expected": null,
    "write": true
  },
  {
    "label": "column width boundary 162",
    "body": "<w:tbl><w:tblGrid><w:gridCol></w:gridCol></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "column",
    "property": "width",
    "expected": null,
    "write": true
  },
  {
    "label": "row grid_cols_after boundary 167",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "grid_cols_after",
    "expected": 0,
    "write": false
  },
  {
    "label": "row grid_cols_after boundary 168",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "grid_cols_after",
    "expected": 0,
    "write": false
  },
  {
    "label": "row grid_cols_after boundary 169",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:gridAfter w:val=\"0\"></w:gridAfter></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "grid_cols_after",
    "expected": 0,
    "write": false
  },
  {
    "label": "row grid_cols_after boundary 170",
    "body": "<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:gridAfter w:val=\"4\"></w:gridAfter></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "grid_cols_after",
    "expected": 4,
    "write": false
  },
  {
    "label": "row grid_cols_before boundary 171",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "grid_cols_before",
    "expected": 0,
    "write": false
  },
  {
    "label": "row grid_cols_before boundary 172",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "grid_cols_before",
    "expected": 0,
    "write": false
  },
  {
    "label": "row grid_cols_before boundary 173",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:gridBefore w:val=\"0\"></w:gridBefore></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "grid_cols_before",
    "expected": 0,
    "write": false
  },
  {
    "label": "row grid_cols_before boundary 174",
    "body": "<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:gridBefore w:val=\"3\"></w:gridBefore></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "grid_cols_before",
    "expected": 3,
    "write": false
  },
  {
    "label": "row height boundary 175",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height",
    "expected": null,
    "write": false
  },
  {
    "label": "row height boundary 176",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height",
    "expected": null,
    "write": false
  },
  {
    "label": "row height boundary 177",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:trHeight></w:trHeight></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height",
    "expected": null,
    "write": false
  },
  {
    "label": "row height boundary 178",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val=\"0\"></w:trHeight></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height",
    "expected": 0,
    "write": false
  },
  {
    "label": "row height boundary 179",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val=\"1440\"></w:trHeight></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height",
    "expected": 914400,
    "write": false
  },
  {
    "label": "row height boundary 180",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height",
    "expected": 914400,
    "write": true
  },
  {
    "label": "row height boundary 181",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height",
    "expected": 914400,
    "write": true
  },
  {
    "label": "row height boundary 182",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:trHeight></w:trHeight></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height",
    "expected": 914400,
    "write": true
  },
  {
    "label": "row height boundary 183",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val=\"1440\"></w:trHeight></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height",
    "expected": 1828800,
    "write": true
  },
  {
    "label": "row height boundary 184",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val=\"2880\"></w:trHeight></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height",
    "expected": null,
    "write": true
  },
  {
    "label": "row height boundary 185",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height",
    "expected": null,
    "write": true
  },
  {
    "label": "row height boundary 186",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height",
    "expected": null,
    "write": true
  },
  {
    "label": "row height boundary 187",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:trHeight></w:trHeight></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height",
    "expected": null,
    "write": true
  },
  {
    "label": "row height_rule boundary 188",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height_rule",
    "expected": null,
    "write": false
  },
  {
    "label": "row height_rule boundary 189",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height_rule",
    "expected": null,
    "write": false
  },
  {
    "label": "row height_rule boundary 190",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val=\"0\" w:hRule=\"auto\"></w:trHeight></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height_rule",
    "expected": "AUTO",
    "write": false
  },
  {
    "label": "row height_rule boundary 191",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val=\"1440\" w:hRule=\"atLeast\"></w:trHeight></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height_rule",
    "expected": "AT_LEAST",
    "write": false
  },
  {
    "label": "row height_rule boundary 192",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val=\"2880\" w:hRule=\"exact\"></w:trHeight></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height_rule",
    "expected": "EXACTLY",
    "write": false
  },
  {
    "label": "row height_rule boundary 193",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height_rule",
    "expected": "AUTO",
    "write": true
  },
  {
    "label": "row height_rule boundary 194",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height_rule",
    "expected": "AT_LEAST",
    "write": true
  },
  {
    "label": "row height_rule boundary 195",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:trHeight></w:trHeight></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height_rule",
    "expected": "EXACTLY",
    "write": true
  },
  {
    "label": "row height_rule boundary 196",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val=\"1440\" w:hRule=\"exact\"></w:trHeight></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height_rule",
    "expected": "AUTO",
    "write": true
  },
  {
    "label": "row height_rule boundary 197",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val=\"1440\" w:hRule=\"auto\"></w:trHeight></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height_rule",
    "expected": null,
    "write": true
  },
  {
    "label": "row height_rule boundary 198",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height_rule",
    "expected": null,
    "write": true
  },
  {
    "label": "row height_rule boundary 199",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height_rule",
    "expected": null,
    "write": true
  },
  {
    "label": "row height_rule boundary 200",
    "body": "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:trHeight></w:trHeight></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>",
    "target": "row",
    "property": "height_rule",
    "expected": null,
    "write": true
  }
];
const enums: Record<string, object> = { alignment: WD_TABLE_ALIGNMENT, table_direction: WD_TABLE_DIRECTION, vertical_alignment: WD_CELL_VERTICAL_ALIGNMENT, height_rule: WD_ROW_HEIGHT_RULE };
describe("table property boundaries", () => {
  it.each(propertyBoundaries)("$label", async ({body, target, property, expected, write}) => {
    const {table} = await open(body);
    const owner = target === "table" ? table : target === "row" ? table.rows.at(0) : target === "column" ? table.columns.at(0) : table.cell(0, 0);
    const properties = owner as unknown as Record<string, unknown>;
    const value = typeof expected === "string" ? (enums[property] as Record<string, unknown>)[expected] : typeof expected === "number" && ["width", "height"].includes(property) ? Length(expected) : expected;
    if (write) properties[property] = value;
    if (write && property === "height_rule" && expected === null && body.includes('w:val="1440"')) {
      expect(properties[property]).toBe(WD_ROW_HEIGHT_RULE.AT_LEAST);
      expect(table.rows.at(0).height?.emu).toBe(914400);
      return;
    }
    const actual = properties[property];
    if (typeof expected === "number" && ["width", "height"].includes(property)) expect((actual as {emu: number}).emu).toBe(expected);
    else expect(actual).toBe(value);
  });
});

const layouts = [
  [cell("Tide") + cell("Reef") + cell("Cove"), cell("Pier") + cell("Bay") + cell("Sound"), cell("Shoal") + cell("Wave") + cell("Gulf")],
  [cell("Tide", 2) + cell("Cove"), cell("Pier") + cell("Bay") + cell("Sound"), cell("Shoal") + cell("Wave") + cell("Gulf")],
  [cell("Tide") + cell("Reef", 1, "restart") + cell("Cove"), cell("Pier") + cell("", 1, "continue") + cell("Sound"), cell("Shoal") + cell("Wave") + cell("Gulf")],
  [cell("Tide", 2, "restart") + cell("Cove"), cell("", 2, "continue") + cell("Sound"), cell("Shoal") + cell("Wave") + cell("Gulf")],
  [cell("Tide", 2) + cell("Cove"), cell("Pier", 1, "restart") + cell("Bay", 2, "restart"), cell("", 1, "continue") + cell("", 2, "continue")],
  [cell("Tide") + cell("Reef") + cell("Cove"), cell("Pier", 3), cell("Shoal") + cell("Wave") + cell("Gulf")],
  [cell("Tide") + cell("Reef", 1, "restart") + cell("Cove"), cell("Pier") + cell("", 1, "continue") + cell("Sound"), cell("Shoal") + cell("", 1, "continue") + cell("Gulf")]
];
const invalidEndpoints = [
  [1,0,0,1,0], [1,1,0,0,0], [2,0,2,0,1],
  [5,0,1,1,0], [5,1,0,2,1], [6,1,0,0,1], [6,0,1,1,2]
];
describe("merge endpoint geometry", () => {
  it.each(invalidEndpoints)("rejects incomplete endpoint rectangle %i:%i,%i-%i,%i", async (layout, row, physicalColumn, otherRow, otherPhysicalColumn) => {
    const {store, table} = await open(rectangle(layouts[layout!]!));
    const grid = table.grid();
    const first = grid.physical[row!]![physicalColumn!]!.owner;
    const second = grid.physical[otherRow!]![otherPhysicalColumn!]!.owner;
    const before = store.xml(store.mainPart).serialize();
    expect(() => table.cell(first.row, first.column).merge(table.cell(second.row, second.column))).toThrow();
    expect(store.xml(store.mainPart).serialize()).toEqual(before);
  });
});

const extentBoundaries = [
  {
    "layout": 0,
    "row": 0,
    "physical": 0,
    "edge": "top",
    "expected": 0,
    "label": "physical cell top boundary 1"
  },
  {
    "layout": 2,
    "row": 0,
    "physical": 1,
    "edge": "top",
    "expected": 0,
    "label": "physical cell top boundary 2"
  },
  {
    "layout": 2,
    "row": 1,
    "physical": 1,
    "edge": "top",
    "expected": 0,
    "label": "physical cell top boundary 3"
  },
  {
    "layout": 4,
    "row": 2,
    "physical": 1,
    "edge": "top",
    "expected": 1,
    "label": "physical cell top boundary 4"
  },
  {
    "layout": 0,
    "row": 0,
    "physical": 0,
    "edge": "left",
    "expected": 0,
    "label": "physical cell left boundary 5"
  },
  {
    "layout": 1,
    "row": 0,
    "physical": 1,
    "edge": "left",
    "expected": 2,
    "label": "physical cell left boundary 6"
  },
  {
    "layout": 3,
    "row": 1,
    "physical": 0,
    "edge": "left",
    "expected": 0,
    "label": "physical cell left boundary 7"
  },
  {
    "layout": 3,
    "row": 1,
    "physical": 1,
    "edge": "left",
    "expected": 2,
    "label": "physical cell left boundary 8"
  },
  {
    "layout": 0,
    "row": 0,
    "physical": 0,
    "edge": "bottom",
    "expected": 1,
    "label": "physical cell bottom boundary 9"
  },
  {
    "layout": 1,
    "row": 0,
    "physical": 0,
    "edge": "bottom",
    "expected": 1,
    "label": "physical cell bottom boundary 10"
  },
  {
    "layout": 2,
    "row": 0,
    "physical": 1,
    "edge": "bottom",
    "expected": 2,
    "label": "physical cell bottom boundary 11"
  },
  {
    "layout": 4,
    "row": 1,
    "physical": 1,
    "edge": "bottom",
    "expected": 3,
    "label": "physical cell bottom boundary 12"
  },
  {
    "layout": 0,
    "row": 0,
    "physical": 0,
    "edge": "right",
    "expected": 1,
    "label": "physical cell right boundary 13"
  },
  {
    "layout": 1,
    "row": 0,
    "physical": 0,
    "edge": "right",
    "expected": 2,
    "label": "physical cell right boundary 14"
  },
  {
    "layout": 4,
    "row": 2,
    "physical": 1,
    "edge": "right",
    "expected": 3,
    "label": "physical cell right boundary 15"
  }
];
it.each(extentBoundaries)("$label", async ({layout, row, physical, edge, expected}) => {
  const {table} = await open(rectangle(layouts[layout]!));
  const grid = table.grid();
  const owner = grid.physical[row]![physical]!.owner;
  const actual = edge === "top" ? owner.row : edge === "left" ? owner.column : edge === "bottom" ? owner.row + owner.rowSpan : owner.column + owner.columnSpan;
  expect(actual).toBe(expected);
  for (let r = owner.row; r < owner.row + owner.rowSpan; r++)
    for (let c = owner.column; c < owner.column + owner.columnSpan; c++)
      expect(table.cell(r, c)).toBe(table.cell(owner.row, owner.column));
});

const rectangleBoundaries = [
  {
    "layout": 0,
    "row": 0,
    "physical": 0,
    "otherRow": 0,
    "otherPhysical": 1,
    "expected": [
      0,
      0,
      1,
      2
    ],
    "label": "rectangle endpoint boundary 1"
  },
  {
    "layout": 0,
    "row": 0,
    "physical": 1,
    "otherRow": 2,
    "otherPhysical": 1,
    "expected": [
      0,
      1,
      3,
      1
    ],
    "label": "rectangle endpoint boundary 2"
  },
  {
    "layout": 0,
    "row": 2,
    "physical": 2,
    "otherRow": 1,
    "otherPhysical": 1,
    "expected": [
      1,
      1,
      2,
      2
    ],
    "label": "rectangle endpoint boundary 3"
  },
  {
    "layout": 0,
    "row": 1,
    "physical": 2,
    "otherRow": 1,
    "otherPhysical": 0,
    "expected": [
      1,
      0,
      1,
      3
    ],
    "label": "rectangle endpoint boundary 4"
  },
  {
    "layout": 1,
    "row": 0,
    "physical": 0,
    "otherRow": 1,
    "otherPhysical": 1,
    "expected": [
      0,
      0,
      2,
      2
    ],
    "label": "rectangle endpoint boundary 5"
  },
  {
    "layout": 1,
    "row": 0,
    "physical": 1,
    "otherRow": 0,
    "otherPhysical": 0,
    "expected": [
      0,
      0,
      1,
      3
    ],
    "label": "rectangle endpoint boundary 6"
  },
  {
    "layout": 2,
    "row": 0,
    "physical": 1,
    "otherRow": 2,
    "otherPhysical": 1,
    "expected": [
      0,
      1,
      3,
      1
    ],
    "label": "rectangle endpoint boundary 7"
  },
  {
    "layout": 2,
    "row": 0,
    "physical": 1,
    "otherRow": 1,
    "otherPhysical": 0,
    "expected": [
      0,
      0,
      2,
      2
    ],
    "label": "rectangle endpoint boundary 8"
  },
  {
    "layout": 2,
    "row": 1,
    "physical": 2,
    "otherRow": 0,
    "otherPhysical": 1,
    "expected": [
      0,
      1,
      2,
      2
    ],
    "label": "rectangle endpoint boundary 9"
  },
  {
    "layout": 4,
    "row": 0,
    "physical": 1,
    "otherRow": 0,
    "otherPhysical": 0,
    "expected": [
      0,
      0,
      1,
      3
    ],
    "label": "rectangle endpoint boundary 10"
  }
];
it.each(rectangleBoundaries)("$label", async ({layout, row, physical, otherRow, otherPhysical, expected}) => {
  const {table} = await open(rectangle(layouts[layout]!));
  const before = table.grid();
  const a = before.physical[row]![physical]!.owner, b = before.physical[otherRow]![otherPhysical]!.owner;
  const merged = table.cell(a.row, a.column).merge(table.cell(b.row, b.column));
  const actual = table.grid().owners.find(o => o.row === expected[0] && o.column === expected[1])!;
  expect([actual.row, actual.column, actual.rowSpan, actual.columnSpan]).toEqual(expected);
  expect(merged).toBe(table.cell(expected[0]!, expected[1]!));
});

it.each([0, 1, 2, 3])("row sequence length %i", async count => {
  const {table} = await open(`<w:tbl>${count ? `<w:tblGrid><w:gridCol/></w:tblGrid>${`<w:tr>${cell()}</w:tr>`.repeat(count)}` : ""}</w:tbl>`);
  expect(table.rows.length).toBe(count);
  expect([...table.rows]).toHaveLength(count);
  for (let i = 0; i < count; i++) expect(table.rows[i]).toBe(table.rows.at(i));
});
it.each([[0,0], [0,1], [0,-1], [1,1], [1,-2], [3,3], [3,-4]])("row sequence bounds %i:%i", async (count, at) => {
  const {table} = await open(`<w:tbl>${count ? `<w:tblGrid><w:gridCol/></w:tblGrid>${`<w:tr>${cell()}</w:tr>`.repeat(count)}` : ""}</w:tbl>`);
  expect(() => table.rows.at(at!)).toThrow(RangeError);
});
it.each([[1,3], [0,-1]])("row exclusive slice %i:%i", async (start,end) => {
  const {table} = await open(rectangle(layouts[0]!));
  expect(table.rows.slice(start,end)).toEqual([table.rows.at(start!), table.rows.at(start! + 1)]);
});

it.each([[0,0,0],[0,1,1],[2,0,2],[2,1,3],[4,2,6]])("physical offset with omitted prefix %i:%i:%i", async (before, physical, offset) => {
  const count = before === 4 ? 4 : 2;
  const body = `<w:tbl><w:tblGrid>${"<w:gridCol/>".repeat(before!+count)}</w:tblGrid><w:tr><w:trPr><w:gridBefore w:val="${before}"/></w:trPr>${cell("Tide").repeat(count)}</w:tr></w:tbl>`;
  const {table} = await open(body);
  expect(table.grid().physical[0]![physical!]!.column).toBe(offset);
  expect(table.cell(0,offset!)).toBe(table.rows.at(0).cells[physical!]);
});
it.each([[0,9,[]],[1,8,[[0,1]]],[2,8,[[1,4]]],[3,6,[[0,1,3,4]]],[4,4,[[0,1],[3,6],[4,5,7,8]]]] as [number,number,number[][]][])("logical alias layout %i", async (layout,unique,matches) => {
  const {table} = await open(rectangle(layouts[layout]!));
  const cells = [...table.rows].flatMap(row => [...row.cells]);
  expect(cells).toHaveLength(9);
  expect(new Set(cells).size).toBe(unique);
  for (const aliases of matches) for (const at of aliases) expect(cells[at]).toBe(cells[aliases[0]!]);
});
it.each([
  [0,0,0,2,1], [0,0,1,1,2], [0,1,1,2,2], [1,0,0,2,2], [2,0,0,2,2], [2,1,2,1,2]
])("span growth %i:%i:%i:%i:%i", async (layout,row,physical,width,height) => {
  const {table} = await open(rectangle(layouts[layout!]!));
  const a = table.grid().physical[row!]![physical!]!.owner;
  table.store.change(table.store.mainPart, xml => {
    const node = table.store.node(table.ref);
    xml.replaceElement(node,editMergedTable(xml,node,node,"tables.merge",{from: `${String.fromCharCode(65+a.column)}${a.row+1}`,to: `${String.fromCharCode(65+a.column+width!-1)}${a.row+height!}`,join: "paragraphs"},table.store.context.budget));
  });
  const merged = table.cell(a.row,a.column);
  expect(merged.grid_span).toBe(width);
  for (let r=a.row;r<a.row+height!;r++) for (let c=a.column;c<a.column+width!;c++) expect(table.cell(r,c)).toBe(merged);
});
it.each([[true,true,1828800],[false,false,null],[false,true,null],[true,false,914400]])("merge width presence %s:%s", async (first,second,expected) => {
  const authored = (width: boolean) => `<w:tc><w:tcPr>${width ? '<w:tcW w:type="dxa" w:w="1440"/>' : ""}</w:tcPr>${paragraph()}</w:tc>`;
  const {table} = await open(rectangle([authored(first as boolean)+authored(second as boolean)],2));
  const merged=table.cell(0,0).merge(table.cell(0,1));
  expect(merged.width?.emu ?? null).toBe(expected);
});
it.each([[1,1,0,false],[1,1,1,false],[1,1,0,true],[2,1,0,false],[1,2,0,false]])("horizontal absorption %i:%i:%i:%s", async (first,second,start,text) => {
  const cells = `${start ? cell() : ""}${cell(text ? "Tide" : "",first!)}${cell(text ? "Reef" : "",second!)}`;
  const {table} = await open(rectangle([cells],start!+first!+second!));
  const merged = table.cell(0,start!).merge(table.cell(0,start!+first!));
  expect(merged.grid_span).toBe(first!+second!);
  expect(merged.text).toBe(text ? "Tide\nReef" : "");
  expect(table.grid().physical[0]).toHaveLength(start!+1);
});
it.each(["", "Harbor", "Harbor\nSounding", "Harbor", "Ti\tde\nReef\n"])("direct cell text boundary %j", async text => {
  const xml = text.split("\n").map(t => `<w:p><w:r>${t.split("\t").map(s => `<w:t>${s}</w:t>`).join("<w:tab/>")}</w:r></w:p>`).join("");
  const {table} = await open(rectangle([`<w:tc>${xml}</w:tc>`],1));
  expect(table.cell(0,0).text).toBe(text);
});
it.each(["Harbor", "Ti\tde\rReef\n"])("whole cell text assignment %j", async text => {
  const {table} = await open(rectangle([cell("Old")],1));
  table.cell(0,0).text=text;
  expect(table.cell(0,0).text).toBe(text.split("\r").join("\n"));
  expect(table.cell(0,0).paragraphs).toHaveLength(1);
});
it("rejects whole cell replacement that would erase a nested table", async () => {
  const {table,store} = await open(rectangle([`<w:tc>${paragraph("Keep")}${rectangle([cell("Nested")],1)}${paragraph()}</w:tc>`],1));
  const before=store.xml(store.mainPart).serialize();
  expect(() => {table.cell(0,0).text="Replacement";}).toThrow();
  expect(store.xml(store.mainPart).serialize()).toEqual(before);
});
it.each([[0,false],[1,false],[2,false],[1,true],[2,true]])("direct nested table count %i:%s", async (count,hasParagraph) => {
  const {table}=await open(rectangle([`<w:tc>${rectangle([cell("Nested")],1).repeat(count!)}${hasParagraph ? paragraph("Tide") : ""}</w:tc>`],1));
  expect(table.cell(0,0).tables).toHaveLength(count!);
  expect(table.cell(0,0).paragraphs).toHaveLength(hasParagraph ? 1 : 0);
  expect(table.cell(0,0).text).toBe(hasParagraph ? "Tide" : "");
});
it.each(["",paragraph(),rectangle([cell("Nested")],1)])("cell paragraph append boundary %j", async body => {
  const {table}=await open(rectangle([`<w:tc>${body}</w:tc>`],1));
  const selected=table.cell(0,0), before=selected.paragraphs.length;
  expect(selected.add_paragraph().text).toBe("");
  expect(selected.paragraphs).toHaveLength(before+1);
  expect([...selected.iter_inner_content()].at(-1)?.element.localName).toBe("p");
});
it.each([[1,1,0],[2,1,0],[1,2,1],[2,2,1]])("row aliases width %i height %i row %i",async (width,height,row) => {
  const rows=[cell("Tide",width!,height===2 ? "restart" : "")];
  if(height===2)rows.push(cell("",width!,"continue"));
  const {table}=await open(rectangle(rows,width));
  expect(table.rows.at(row!).cells).toHaveLength(width!);
  for(const entry of table.rows.at(row!).cells)expect(entry).toBe(table.cell(0,0));
});
it.each(["", "<w:tblPrEx/>", cell(), `<w:sdt/><w:del/>${cell()}`])("row property container insertion boundary %j", async children => {
  const {table,store}=await open(`<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr>${children.includes("tblPrEx") ? children + cell() : children || cell()}</w:tr></w:tbl>`);
  table.rows.at(0).height=Length(914400);
  const names=store.node(table.rows.at(0).ref).children.map(n=>n.localName);
  expect(names.indexOf("trPr")).toBe(children.includes("tblPrEx") ? 1 : 0);
  if(children.includes("<w:sdt")) expect(names).toEqual(["trPr","sdt","del","tc"]);
});
it.each([[0,3],[1,1]])("physical grid-start miss %i:%i",async(layout,column)=>{
  const {table}=await open(rectangle(layouts[layout!]!));
  expect(table.grid().physical[0]!.find(p=>p.column===column)).toBeUndefined();
  if(column===3)expect(()=>table.cell(0,column)).toThrow(RangeError);
  else expect(table.cell(0,column!)).toBe(table.cell(0,0));
});
it.each([0,4])("topmost row has no preceding physical row %i",async layout=>{
  const {table}=await open(rectangle(layouts[layout]!));
  expect(table.grid().physical[0]![0]!.row).toBe(0);
  expect(()=>table.rows.at(-table.rows.length-1)).toThrow(RangeError);
});
it.each([1,3])("explicit span cannot swallow outside selected width %i",async columns=>{
  const {table,store}=await open(rectangle([columns===1 ? cell() : cell()+cell("",2)],columns));
  const before=store.xml(store.mainPart).serialize();
  expect(()=>store.change(store.mainPart,xml=>{
    const node=store.node(table.ref);
    xml.replaceElement(node,editMergedTable(xml,node,node,"tables.merge",{from:"A1",to:"B1",join:"paragraphs"},store.context.budget));
  })).toThrow();
  expect(store.xml(store.mainPart).serialize()).toEqual(before);
});
it.each([["<w:p/>","<w:p/>"],["<w:p/>","<w:p><w:r/></w:p>"],["<w:p><w:r/></w:p>","<w:p/>"],["<w:p><w:r/></w:p><w:sdt/>","<w:p/>"],["<w:p><w:r/></w:p><w:sdt/>",rectangle([cell("Nested")],1)+"<w:p/>"]])("ordered merge blocks %j into %j",async(first,second)=>{
  const {table,store}=await open(rectangle([`<w:tc>${first}</w:tc><w:tc>${second}</w:tc>`],2));
  const merged=table.cell(0,0).merge(table.cell(0,1));
  expect(merged.text).toBe(second!.includes("tbl") ? "\n" : "");
  const names=store.node(merged.ref).children.filter(n=>n.localName!=="tcPr").map(n=>n.localName);
  if(first!.includes("sdt"))expect(names).toEqual(second!.includes("tbl") ? ["p","sdt","tbl","p"] : ["p","sdt"]);
  else expect(merged.paragraphs).toHaveLength(1);
  if(first!.includes("w:r") || second!.includes("w:r"))expect(store.node(merged.ref).children.find(n=>n.localName==="p")!.children[0]!.localName).toBe("r");
});
it("keeps inherited public views and all collection owners",async()=>{
  const {table}=await open(rectangle(layouts[0]!));
  const row=table.rows.at(1),column=table.columns.at(1),selected=table.cell(1,1);
  for(const owner of [table,row,column,selected,table.rows,table.columns]){
    expect(owner.table).toBe(table);expect(owner.part).toBe(table.part);
  }
  expect(row.element.localName).toBe("tr");expect(column.element.localName).toBe("gridCol");expect(selected.element.localName).toBe("tc");
  expect(row.cells).toEqual(table.row_cells(1));expect(column.cells).toEqual(table.column_cells(1));
  expect(row.cells.map(c=>c.text)).toEqual(["Pier","Bay","Sound"]);
  expect(column.cells.map(c=>c.text)).toEqual(["Reef","Bay","Wave"]);
  expect([...table.rows]).toHaveLength(3);expect([...table.columns]).toHaveLength(3);
  for(let r=0;r<3;r++)for(let c=0;c<3;c++)expect(table.cell(r,c)).toBe(table.rows[r]!.cells[c]);
  expect(table.columns[1]).toBe(column);
  expect(()=>table.columns.at(3)).toThrow(RangeError);expect(()=>table.columns.at(-4)).toThrow(RangeError);
});
it("adds row and column with width-bearing returned owners",async()=>{
  const {table}=await open('<w:tbl><w:tblGrid><w:gridCol w:w="1440"/><w:gridCol w:w="2880"/></w:tblGrid><w:tr>'+cell("Tide")+cell("Reef")+'</w:tr></w:tbl>');
  const row=table.add_row();expect(row).toBe(table.rows.at(-1));expect(row.table).toBe(table);
  expect(row.cells.map(c=>c.width?.emu)).toEqual([914400,1828800]);
  const column=table.add_column(Length(1371600));expect(column).toBe(table.columns.at(-1));expect(column.table).toBe(table);
  expect(column.width?.emu).toBe(1371600);expect(column.cells.map(c=>c.width?.emu)).toEqual([1371600,1371600]);
  expect(table.cell(0,0).text).toBe("Tide");expect(table.cell(0,1).text).toBe("Reef");
});
it("creates nested tables with a terminal paragraph and public ordered traversal",async()=>{
  const {table}=await open(rectangle([cell("Tide")],1));const selected=table.cell(0,0);
  selected.width=Length(1828800);const nested=selected.add_table(2,2);
  expect(nested.rows.length).toBe(2);expect(nested.columns.length).toBe(2);
  expect(nested.columns.at(0).width?.emu).toBe(914400);
  expect(selected.tables).toEqual([nested]);expect(selected.paragraphs.map(p=>p.text)).toEqual(["Tide",""]);
  expect([...selected.iter_inner_content()].map(n=>n.element.localName)).toEqual(["p","tbl","p"]);
});

it.each(["create","replace","clear"])("table style transition %s",async mode=>{
  const {table,store}=await open(rectangle([cell("Tide")],1));
  const first=store.styles.add_style("Coastal grid",WD_STYLE_TYPE.TABLE);
  const second=store.styles.add_style("Sounding grid",WD_STYLE_TYPE.TABLE);
  if(mode!=="create")table.style=first;
  table.style=mode==="clear" ? null : mode==="replace" ? "Sounding grid" : "Coastal grid";
  if(mode==="clear")expect(table.element.children.find(n=>n.localName==="tblPr")?.children.some(n=>n.localName==="tblStyle")).toBe(false);
  else { expect(table.style?.style_id).toBe((mode==="replace" ? second : first).style_id); expect(table.style?.type).toBe(WD_STYLE_TYPE.TABLE); }
  expect(table.cell(0,0).text).toBe("Tide");
});
it("extends across several physical spans and keeps continuation markers",async()=>{
  const {table,store}=await open(rectangle([cell("Tide")+cell("Reef",2)+cell("Cove"),cell()+cell("",2)+cell()],4));
  const merged=table.cell(0,0).merge(table.cell(1,3));
  expect(merged.grid_span).toBe(4);expect(merged.text).toBe("Tide\nReef\nCove");
  const grid=table.grid();expect(grid.physical.map(row=>row.length)).toEqual([1,1]);
  expect(grid.physical[1]![0]!.owner).toBe(grid.physical[0]![0]!.owner);
  const continuation=grid.original(grid.physical[1]![0]!.node);
  expect(continuation.children.find(n=>n.localName==="tcPr")!.children.find(n=>n.localName==="vMerge")!.attributes.find(a=>a.localName==="val")!.value).toBe("continue");
  expect(store.node(merged.ref).children.filter(n=>n.localName==="p")).toHaveLength(3);
});
