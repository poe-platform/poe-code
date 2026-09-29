import type { FormatProvider } from "../codecs/types.js";
import { readOdf, probeOdf, createOdfWriter } from "../codecs/odf.js";
import { odfEncryptionProfiles } from "../codecs/odf-encrypted-write.js";

export const odsFormat = {
  "id": "Gnumeric_OpenCalc",
  "services": [
    {
      "id": "openoffice",
      "direction": "read",
      read: readOdf,
      probeContent: probeOdf,
      "description": "Open Document Format (*.sxc, *.ods)",
      "extensions": [
        "ods",
        "ots",
        "sxc",
        "stc"
      ],
      "mimeTypes": [
        "application/vnd.oasis.opendocument.spreadsheet",
        "application/vnd.oasis.opendocument.spreadsheet-template",
        "application/vnd.sun.xml.calc",
        "application/vnd.sun.xml.calc.template"
      ],
      "probePriority": 1,
      "contentProbe": true
    },
    {
      "id": "openoffice",
      "direction": "write",
      write: createOdfWriter("strict"),
      labelRanges: true,
      exportOptionRules: { encryption: { kind: "enum", values: [...odfEncryptionProfiles.keys()] } },
      "description": "ODF 1.2 strict conformance (*.ods)",
      "extensions": [
        "ods"
      ],
      "mimeTypes": [
        "application/vnd.oasis.opendocument.spreadsheet"
      ],
      "formatLevel": "auto"
    },
    {
      "id": "odf",
      "direction": "write",
      write: createOdfWriter("extended"),
      labelRanges: true,
      exportOptionRules: { encryption: { kind: "enum", values: [...odfEncryptionProfiles.keys()] } },
      "description": "ODF 1.2 extended conformance (*.ods)",
      "extensions": [
        "ods"
      ],
      "mimeTypes": [
        "application/vnd.oasis.opendocument.spreadsheet"
      ],
      "formatLevel": "auto"
    }
  ],
  "source": "plugins/openoffice/plugin.xml.in"
} satisfies FormatProvider;
