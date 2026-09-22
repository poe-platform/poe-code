import type { FormatProvider } from "../types.js";
import { probeGnumeric, readGnumeric, writeGnumeric, writeCompressedGnumeric } from "../gnumeric.js";

export default {
  "id": "Gnumeric_XmlIO",
  source: "src/xml-sax-write.c",
  services: [
    { id: "sax", direction: "read", description: "Gnumeric XML (*.gnumeric)", extensions: ["gnumeric", "xml"], filenameSuffixes: ["xml.gz"], mimeTypes: ["application/x-gnumeric"], contentProbe: true, source: "src/xml-sax-read.c:3901", probeContent: probeGnumeric, read: readGnumeric },
    { id: "sax", direction: "write", description: "Gnumeric XML (*.gnumeric)", extensions: ["gnumeric"], mimeTypes: ["application/x-gnumeric"], byteStrings: "formula-only", formatLevel: "auto", defaultSaverPriority: 50, write: writeCompressedGnumeric },
    { id: "sax:0", direction: "write", description: "Gnumeric XML uncompressed (*.xml)", extensions: ["xml"], mimeTypes: ["application/xml"], byteStrings: "formula-only", formatLevel: "auto", write: writeGnumeric }
  ]
} satisfies FormatProvider;
