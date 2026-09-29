import type { FormatProvider } from "../codecs/types.js";
import { probeSpreadsheetML, readSpreadsheetML } from "../codecs/spreadsheetml.js";

export const spreadsheetmlFormat: FormatProvider = {
  id: "Gnumeric_Excel",
  source: "plugins/excel/plugin.xml.in",
  services: [
{
      "id": "excel_xml",
      "direction": "read",
      read: readSpreadsheetML,
      probeContent: probeSpreadsheetML,
      "description": "MS Excel™ 2003 SpreadsheetML",
      "extensions": [
        "xml"
      ],
      "probePriority": 1,
      "contentProbe": true
    }
  ]
};
