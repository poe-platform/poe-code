import type { FormatProvider } from "../codecs/types.js";
import { probeBiff, readBiff, createBiffWriter } from "../codecs/biff.js";
import { biffEncryptionProfiles, biffLegacyEncryptionOptions } from "../codecs/biff-encrypted-write.js";

export const xlsFormat = {
  id: "Gnumeric_Excel",
  source: "plugins/excel/plugin.xml.in",
  services: [
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
      labelRanges: true,
      exportOptionRules: { encryption: { kind: "enum", values: [...biffEncryptionProfiles.keys()] } },
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
      write: createBiffWriter("dsf"),
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
      read: readBiff,
      "description": "MS Excel™ (*.xls) requiring encoding specification",
      "extensions": [],
      "probePriority": 200,
      "encodingDependent": true
    }
  ]
} satisfies FormatProvider;
