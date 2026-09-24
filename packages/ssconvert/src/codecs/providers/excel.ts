import type { FormatProvider } from "../types.js";
import { probeXlsx, readXlsx, createXlsxWriter } from "../xlsx.js";
import { probeBiff, readBiff, createBiffWriter } from "../biff.js";
import { probeSpreadsheetML, readSpreadsheetML } from "../spreadsheetml.js";

export default {
  "id": "Gnumeric_Excel",
  "services": [
    {
      "id": "excel",
      "direction": "read",
      read: readBiff,
      probeContent: probeBiff,
      "description": "MS Excel™ (*.xls)",
      "extensions": [
        "xls",
        "xlw",
        "xlt"
      ],
      "mimeTypes": [
        "application/vnd.ms-excel",
        "application/excel",
        "application/msexcel",
        "application/x-excel",
        "application/x-ms-excel",
        "application/x-msexcel",
        "application/x-xls",
        "application/xls",
        "application/x-dos_ms_excel",
        "zz-application/zz-winassoc-xls"
      ],
      "probePriority": 100,
      "contentProbe": true
    },
    {
      "id": "excel_biff8",
      write: createBiffWriter(8),
      exportOptionRules: { encryption: { kind: "enum", values: ["rc4"] } },
      "direction": "write",
      "description": "MS Excel™ 97/2000/XP",
      "extensions": [
        "xls"
      ],
      "mimeTypes": [
        "application/vnd.ms-excel"
      ],
      "formatLevel": "auto",
      "defaultSaverPriority": 1
    },
    {
      "id": "excel_biff7",
      write: createBiffWriter(7),
      "direction": "write",
      "description": "MS Excel™ 5.0/95",
      "extensions": [
        "xls"
      ],
      "mimeTypes": [
        "application/vnd.ms-excel"
      ],
      "formatLevel": "auto"
    },
    {
      "id": "excel_dsf",
      write: createBiffWriter("dsf"),
      "direction": "write",
      "description": "MS Excel™ 97/2000/XP & 5.0/95",
      "extensions": [
        "xls"
      ],
      "mimeTypes": [
        "application/vnd.ms-excel"
      ],
      "formatLevel": "auto"
    },
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
    },
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
    },
    {
      "id": "excel_enc",
      "direction": "read",
      read: readBiff,
      "description": "MS Excel™ (*.xls) requiring encoding specification",
      "extensions": [],
      "probePriority": 200,
      "encodingDependent": true
    }
  ],
  "source": "plugins/excel/plugin.xml.in"
} satisfies FormatProvider;
