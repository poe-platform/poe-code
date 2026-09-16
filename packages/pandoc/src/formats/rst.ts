import type { FormatDescriptor } from "../formats.js";
import { writeRst } from "../rst-writer.js";
import { rstReader } from "../rst.js";
export default {
  reader: rstReader,
  writer: {format: "rst", math: "source", write: writeRst},
  name: "rst",
  read: true,
  write: true,
  media: "text",
  inputEncoding: "utf8",
  suffixes: ["rst"],
  extensions: {},
  options: {
    read: [],
    write: ["wrap", "columns"]
  }
} satisfies FormatDescriptor;
