import type { FormatProvider } from "@poe-code/spreadsheet-engine/codecs/types";

export const spreadsheetmlFormat: FormatProvider = {
  id: "Gnumeric_Excel",
  source: "plugins/excel/plugin.xml.in",
  services: [
    {
      "id": "excel_xml",
      "direction": "read",
      read: async (bytes, context) => (await import("./spreadsheetml.js")).readSpreadsheetML(bytes, context),
      probeContent: async (...args) => (await import("./spreadsheetml.js")).probeSpreadsheetML(...args),
      "description": "MS Excel™ 2003 SpreadsheetML",
      "extensions": [
        "xml"
      ],
      "probePriority": 1,
      "contentProbe": true
    }
  ]
};
