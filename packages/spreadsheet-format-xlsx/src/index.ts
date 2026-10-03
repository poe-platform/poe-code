import type { FormatProvider } from "@poe-code/spreadsheet-engine/codecs/types";

export const xlsxFormat: FormatProvider = {
  id: "Gnumeric_Excel",
  source: "plugins/excel/plugin.xml.in",
  services: [
{
      "id": "xlsx",
      "direction": "read",
      probeContent: async (bytes, context) => (await import("./xlsx.js")).probeXlsx(bytes, context),
      probeSource: async (source, context) => (await import("./xlsx.js")).probeXlsx(source, context),
      readSource: async (source, context) => (await import("./xlsx.js")).readXlsx(source, context),
      read: async (bytes, context) => (await import("./xlsx.js")).readXlsx(bytes, context),
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
      write: async (book, options, context) => (await import("./xlsx.js")).createXlsxWriter("2006")(book, options, context),
      writeStream: async function* (book, options, context) { yield* (await import("./xlsx.js")).createXlsxStreamWriter("2006")(book, options, context); },
      writeWorkbookSource: async function* (source, options, context) { yield* (await import("./xlsx.js")).createXlsxStreamWriter("2006")(source, options, context); },
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
      write: async (book, options, context) => (await import("./xlsx.js")).createXlsxWriter("2008")(book, options, context),
      writeStream: async function* (book, options, context) { yield* (await import("./xlsx.js")).createXlsxStreamWriter("2008")(book, options, context); },
      writeWorkbookSource: async function* (source, options, context) { yield* (await import("./xlsx.js")).createXlsxStreamWriter("2008")(source, options, context); },
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
