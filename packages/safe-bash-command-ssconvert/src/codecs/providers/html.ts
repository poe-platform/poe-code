import { createLatexWriter } from "../latex.js";
import { writeRoff } from "../roff.js";
import type { FormatProvider } from "../types.js";
import { createHtmlWriter, probeHtml, readHtml } from "../html.js";

export default {
  "id": "Gnumeric_html",
  "services": [
    {
      "id": "html",
      "direction": "read",
      read: readHtml,
      probeContent: probeHtml,
      "description": "HTML (*.html, *.htm)",
      "extensions": [
        "html",
        "htm"
      ],
      "probePriority": 100,
      "contentProbe": true
    },
    {
      "id": "html32",
      write: createHtmlWriter({ header: "HTML32", legacy: true, fontColor: true }),
      "direction": "write",
      "description": "HTML 3.2 (*.html)",
      "extensions": [
        "html"
      ],
      "sheetSelection": true
    },
    {
      "id": "html40",
      write: createHtmlWriter({ header: "HTML40" }),
      "direction": "write",
      "description": "HTML 4.0 (*.html)",
      "extensions": [
        "html"
      ],
      "sheetSelection": true
    },
    {
      "id": "html40frag",
      write: createHtmlWriter({ header: "fragment", fontColor: true, backgroundAttribute: true }),
      "direction": "write",
      "description": "HTML (*.html) fragment",
      "extensions": [
        "html"
      ],
      "sheetSelection": true
    },
    {
      "id": "xhtml",
      write: createHtmlWriter({ header: "XHTML", fontColor: true, backgroundAttribute: true }),
      "direction": "write",
      "description": "XHTML (*.html)",
      "extensions": [
        "html"
      ],
      "sheetSelection": true
    },
    {
      "id": "xhtml_range",
      write: createHtmlWriter({ header: "XHTML", fontColor: true, backgroundAttribute: true, rangeScope: true }),
      "direction": "write",
      "description": "XHTML range - for export to clipboard",
      "extensions": [
        "html"
      ],
      "saveScope": "range"
    },
    {
      "id": "latex",
      write: createLatexWriter({}),
      "direction": "write",
      "description": "LaTeX 2e (*.tex)",
      "extensions": [
        "tex"
      ],
      "saveScope": "sheet",
      "sheetSelection": true,
      honorsExportRange: true,
      selectionSource: "runtime"
    },
    {
      "id": "latex_table",
      write: createLatexWriter({ fragment: true }),
      "direction": "write",
      "description": "LaTeX 2e (*.tex) table fragment",
      "extensions": [
        "tex"
      ],
      "saveScope": "sheet",
      "sheetSelection": true,
      honorsExportRange: true,
      selectionSource: "runtime"
    },
    {
      "id": "latex_table_visible",
      write: createLatexWriter({ fragment: true, visibleRows: true }),
      "direction": "write",
      "description": "LaTeX 2e (*.tex) table fragment of visible rows",
      "extensions": [
        "tex"
      ],
      "saveScope": "sheet",
      "sheetSelection": true,
      honorsExportRange: true,
      selectionSource: "runtime"
    },
    {
      "id": "roff",
      write: writeRoff,
      "direction": "write",
      "description": "TROFF (*.me)",
      "extensions": [
        "me"
      ]
    }
  ],
  "source": "plugins/html/plugin.xml.in"
} satisfies FormatProvider;
