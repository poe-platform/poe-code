import type { FormatProvider } from "../types.js";

export default {
  "id": "Gnumeric_XmlIO",
  source: "src/xml-sax-write.c",
  services: [
    { id: "sax", direction: "read", description: "Gnumeric XML (*.gnumeric)", extensions: ["gnumeric", "xml"], filenameSuffixes: ["xml.gz"], mimeTypes: ["application/x-gnumeric"], contentProbe: true, source: "src/xml-sax-read.c:3901", probeContent: async (...args) => (await import("../gnumeric.js")).probeGnumeric(...args), read: async (bytes, context) => (await import("../gnumeric.js")).readGnumeric(bytes, context) },
    { id: "sax", direction: "write", description: "Gnumeric XML (*.gnumeric)", extensions: ["gnumeric"], mimeTypes: ["application/x-gnumeric"], byteStrings: "formula-only", formatLevel: "auto", defaultSaverPriority: 50, write: async (book, options, context) => (await import("../gnumeric.js")).writeCompressedGnumeric(book, options, context) },
    { id: "sax:0", direction: "write", description: "Gnumeric XML uncompressed (*.xml)", extensions: ["xml"], mimeTypes: ["application/xml"], byteStrings: "formula-only", formatLevel: "auto", write: async (book, options, context) => (await import("../gnumeric.js")).writeGnumeric(book, options, context) }
  ]
} satisfies FormatProvider;
