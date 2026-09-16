import type { FormatDescriptor } from "../formats.js";
import { pdfWriter } from "../pdf-writer.js";
export default {
  writer: pdfWriter,
  name: "pdf",
  read: false,
  write: true,
  media: "binary",
  inputEncoding: "bytes",
  suffixes: ["pdf"],
  extensions: {},
  options: {
    read: [],
    write: ["standalone", "pdfPage", "pdfFonts"]
  }
} satisfies FormatDescriptor;
