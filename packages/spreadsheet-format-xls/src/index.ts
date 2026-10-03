import type { FormatProvider } from "@poe-code/spreadsheet-engine/codecs/types";

const biffEncryptionValues = [
  "xor",
  "rc4",
  ...[false, true].flatMap(encryptedProperties =>
    [40, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120, 128].map(
      bits => `rc4-cryptoapi-${bits}${encryptedProperties ? "-properties" : ""}`
    )
  )
];
const biffLegacyEncryptionOptions = ["xor"];

export const xlsFormat: FormatProvider = {
  id: "Gnumeric_Excel",
  source: "plugins/excel/plugin.xml.in",
  services: [
    {
      "id": "excel",
      "direction": "read",
      readWorkbookSource: async (...args) => (await import("./biff.js")).readBiffWorkbookSource(...args),
      readSource: async (...args) => (await import("./biff.js")).readBiff(...args),
      probeSource: async (...args) => (await import("./biff.js")).probeBiff(...args),
      read: async (...args) => (await import("./biff.js")).readBiff(...args),
      probeContent: async (...args) => (await import("./biff.js")).probeBiff(...args),
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
      write: async (...args) => (await import("./biff.js")).createBiffWriter(8)(...args),
      labelRanges: true,
      exportOptionRules: { encryption: { kind: "enum", values: biffEncryptionValues } },
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
      write: async (...args) => (await import("./biff.js")).createBiffWriter(7)(...args),
      labelRanges: true,
      exportOptionRules: { encryption: { kind: "enum", values: biffLegacyEncryptionOptions } },
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
      write: async (...args) => (await import("./biff.js")).createBiffWriter("dsf")(...args),
      labelRanges: true,
      exportOptionRules: { encryption: { kind: "enum", values: biffLegacyEncryptionOptions } },
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
      "id": "excel_enc",
      "direction": "read",
      read: async (...args) => (await import("./biff.js")).readBiff(...args),
      "description": "MS Excel™ (*.xls) requiring encoding specification",
      "extensions": [],
      "probePriority": 200,
      "encodingDependent": true
    }
  ]
};
