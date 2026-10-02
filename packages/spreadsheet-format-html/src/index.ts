import type { FormatProvider } from "@poe-code/spreadsheet-engine/codecs/types";

export const htmlFormat: FormatProvider = {
  id: "Gnumeric_html",
  source: "plugins/html/plugin.xml.in",
  services: [
    {
      "id": "html",
      "direction": "read",
      read: async (bytes, context) => (await import("./html.js")).readHtml(bytes, context),
      probeContent: async (...args) => (await import("./html.js")).probeHtml(...args),
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
      write: async (...args) => (await import("./html.js")).createHtmlWriter({ header: "HTML32", legacy: true, fontColor: true })(...args),
      "direction": "write",
      "description": "HTML 3.2 (*.html)",
      "extensions": [
        "html"
      ],
      "sheetSelection": true
    },
    {
      "id": "html40",
      write: async (...args) => (await import("./html.js")).createHtmlWriter({ header: "HTML40" })(...args),
      "direction": "write",
      "description": "HTML 4.0 (*.html)",
      "extensions": [
        "html"
      ],
      "sheetSelection": true
    },
    {
      "id": "html40frag",
      write: async (...args) => (await import("./html.js")).createHtmlWriter({ header: "fragment", fontColor: true, backgroundAttribute: true })(...args),
      "direction": "write",
      "description": "HTML (*.html) fragment",
      "extensions": [
        "html"
      ],
      "sheetSelection": true
    },
    {
      "id": "xhtml",
      write: async (...args) => (await import("./html.js")).createHtmlWriter({ header: "XHTML", fontColor: true, backgroundAttribute: true })(...args),
      "direction": "write",
      "description": "XHTML (*.html)",
      "extensions": [
        "html"
      ],
      "sheetSelection": true
    },
    {
      "id": "xhtml_range",
      write: async (...args) => (await import("./html.js")).createHtmlWriter({ header: "XHTML", fontColor: true, backgroundAttribute: true, rangeScope: true })(...args),
      "direction": "write",
      "description": "XHTML range - for export to clipboard",
      "extensions": [
        "html"
      ],
      "saveScope": "range"
    }
  ]
};
