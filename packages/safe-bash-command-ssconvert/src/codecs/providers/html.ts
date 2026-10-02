import type { FormatProvider } from "../types.js";
import { htmlFormat } from "../../formats/html.js";

export default {
  ...htmlFormat,
  services: [
    ...htmlFormat.services,
    {
      "id": "latex",
      write: async (...args) => (await import("../latex.js")).createLatexWriter({})(...args),
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
      write: async (...args) => (await import("../latex.js")).createLatexWriter({ fragment: true })(...args),
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
      write: async (...args) => (await import("../latex.js")).createLatexWriter({ fragment: true, visibleRows: true })(...args),
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
      write: async (...args) => (await import("../roff.js")).writeRoff(...args),
      "direction": "write",
      "description": "TROFF (*.me)",
      "extensions": [
        "me"
      ]
    }
  ]
} satisfies FormatProvider;
