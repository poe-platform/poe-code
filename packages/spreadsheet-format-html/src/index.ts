import type { FormatProvider } from "@poe-code/spreadsheet-engine/codecs/types";
import { createHtmlWriter, probeHtml, readHtml } from "./html.js";

export const htmlFormat: FormatProvider = {
  id: "Gnumeric_html",
  source: "plugins/html/plugin.xml.in",
  services: [
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
    }
  ]
};
