import type { FormatDescriptor } from "../formats.js";
import { pptxReader, pptxWriter } from "../pptx.js";
export default {
  name: "pptx",
  read: true,
  write: true,
  media: "binary",
  inputEncoding: "bytes",
  reader: pptxReader,
  writer: pptxWriter,
  suffixes: ["pptx"],
  extensions: {},
  options: {
    read: [],
    write: ["standalone"]
  }
} satisfies FormatDescriptor;
