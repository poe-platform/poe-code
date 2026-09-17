import type { FormatDescriptor } from "../formats.js";
import { epubReader } from "../epub.js";
import { epubWriter } from "../epub-writer.js";
export default {
  reader: epubReader,
  writer: epubWriter,
  aliases: {write: ["epub3"]},
  name: "epub",
  read: true,
  write: true,
  media: "binary",
  inputEncoding: "bytes",
  suffixes: ["epub"],
  extensions: {},
  options: {
    read: [],
    write: ["standalone", "epub"]
  },
  inputBudget: "compressedBytes"
} satisfies FormatDescriptor;
