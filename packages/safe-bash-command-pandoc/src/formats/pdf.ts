import type { FormatDescriptor } from "../formats.js";
import { pdfWriter } from "../pdf-writer.js";
import { pdfReader } from "../pdf-reader.js";
export default {
  reader: pdfReader,
  writer: pdfWriter,
  name: "pdf",
  read: true,
  write: true,
  media: "binary",
  inputEncoding: "bytes",
  suffixes: ["pdf"],
  extensions: {},
  options: {
    read: [],
    write: ["standalone", "pdfPage", "pdfFonts", "pdf"]
  }
} satisfies FormatDescriptor;
