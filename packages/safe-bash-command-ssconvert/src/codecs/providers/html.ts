import { createLatexWriter } from "../latex.js";
import { writeRoff } from "../roff.js";
import type { FormatProvider } from "../types.js";
import { htmlFormat } from "../../formats/html.js";

export default {
  ...htmlFormat,
  services: [
    ...htmlFormat.services,
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
  ]
} satisfies FormatProvider;
