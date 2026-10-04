import type { FormatProvider } from "@poe-code/spreadsheet-engine/codecs/types";

const odfEncryptionValues = [
  "odf12-aes128-cbc",
  "odf12-aes192-cbc",
  "odf12-aes256-cbc",
  "odf12-blowfish-cfb8",
  "odf12-blowfish-cfb64",
  "libreoffice-aes256-gcm"
];

export const odsFormat: FormatProvider = {
  "id": "Gnumeric_OpenCalc",
  "services": [
    {
      "id": "openoffice",
      "direction": "read",
      probeSource: async (...args) => (await import("./odf.js")).probeOdf(...args),
      readSource: async (source, context) => (await import("./odf.js")).readOdf(source, context),
      read: async (bytes, context) => (await import("./odf.js")).readOdf(bytes, context),
      probeContent: async (...args) => (await import("./odf.js")).probeOdf(...args),
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
      sourceAxes: true,
      write: async (book, options, context) => (await import("./odf.js")).createOdfWriter("strict")(book, options, context),
      writeStream: async function* (book, options, context) { yield* (await import("./odf.js")).createOdfStreamWriter("strict")(book, options, context); },
      writeWorkbookSource: async function* (source, options, context) { yield* (await import("./odf.js")).createOdfStreamWriter("strict")(source, options, context); },
      labelRanges: true,
      exportOptionRules: { encryption: { kind: "enum", values: odfEncryptionValues } },
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
      sourceAxes: true,
      write: async (book, options, context) => (await import("./odf.js")).createOdfWriter("extended")(book, options, context),
      writeStream: async function* (book, options, context) { yield* (await import("./odf.js")).createOdfStreamWriter("extended")(book, options, context); },
      writeWorkbookSource: async function* (source, options, context) { yield* (await import("./odf.js")).createOdfStreamWriter("extended")(source, options, context); },
      labelRanges: true,
      exportOptionRules: { encryption: { kind: "enum", values: odfEncryptionValues } },
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
};
