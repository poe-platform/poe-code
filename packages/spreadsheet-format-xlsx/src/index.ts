import type { FormatProvider } from "@poe-code/spreadsheet-engine/codecs/types";
import { probeXlsx, readXlsx, createXlsxWriter } from "./xlsx.js";

export const xlsxFormat: FormatProvider = {
  id: "Gnumeric_Excel",
  source: "plugins/excel/plugin.xml.in",
  services: [
{
      "id": "xlsx",
      "direction": "read",
      probeContent: probeXlsx,
      read: readXlsx,
      "description": "ECMA 376 / Office Open XML [MS Excel™ 2007/2010] (*.xlsx)",
      "extensions": [
        "xlsx",
        "xltx",
        "xlsb",
        "xlsm",
        "xltm"
      ],
      "mimeTypes": [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.template"
      ],
      "probePriority": 100,
      "contentProbe": true
    },
{
      "id": "xlsx",
      "direction": "write",
      write: createXlsxWriter("2006"),
      "description": "ECMA 376 1st edition (2006); [MS Excel™ 2007]",
      "extensions": [
        "xlsx"
      ],
      "mimeTypes": [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      ],
      "formatLevel": "auto"
    },
{
      "id": "xlsx2",
      "direction": "write",
      write: createXlsxWriter("2008"),
      "description": "ISO/IEC 29500:2008 & ECMA 376 2nd edition (2008); [MS Excel™ 2010]",
      "extensions": [
        "xlsx"
      ],
      "mimeTypes": [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      ],
      "formatLevel": "auto"
    }
  ]
};
