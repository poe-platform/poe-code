export interface TablePropertyBoundary { label: string; body: string; target: string; property: string; expected: number | string | boolean | null; write: boolean }
export const tablePropertyBoundaries: TablePropertyBoundary[] = [
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
