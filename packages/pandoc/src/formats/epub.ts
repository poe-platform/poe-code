import type { FormatDescriptor } from "../formats.js";
import { epubReader } from "../epub.js";
export default {
  reader: epubReader,
  name: "epub",
  read: true,
  write: true,
  media: "binary",
  inputEncoding: "bytes",
  suffixes: ["epub"],
  extensions: {},
  options: {
    read: [],
    write: ["standalone"]
  },
  inputBudget: "compressedBytes"
} satisfies FormatDescriptor;
