import type { FormatProvider } from "../types.js";
import { readOdf, probeOdf, createOdfWriter } from "../odf.js";

export default {
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
      exportOptionRules: { encryption: { kind: "enum", values: ["odf12-aes256-cbc"] } },
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
      exportOptionRules: { encryption: { kind: "enum", values: ["odf12-aes256-cbc"] } },
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
