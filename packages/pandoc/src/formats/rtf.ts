import type { FormatDescriptor } from "../formats.js";
import { rtfReader } from "../rtf.js";
import { writeRtf } from "../rtf-writer.js";
export default {
  reader: rtfReader,
  writer: {format: "rtf", write: writeRtf},
  name: "rtf",
  read: true,
  write: true,
  media: "text",
  inputEncoding: "bytes",
  suffixes: ["rtf"],
  extensions: {},
  options: {
    read: [],
    write: ["standalone"]
  }
} satisfies FormatDescriptor;
