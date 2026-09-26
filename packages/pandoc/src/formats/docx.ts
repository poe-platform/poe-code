import type { FormatDescriptor } from "../formats.js";
import { docxReader, docxWriter } from "../docx.js";
export default {
  reader: docxReader,
  writer: docxWriter,
  name: "docx",
  read: true,
  write: true,
  media: "binary",
  inputEncoding: "bytes",
  suffixes: ["docx"],
  extensions: {},
  options: {
    read: [],
    write: ["standalone"]
  }
} satisfies FormatDescriptor;
