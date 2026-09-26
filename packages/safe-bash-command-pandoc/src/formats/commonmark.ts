import type { FormatDescriptor } from "../formats.js";
import { commonmarkReader } from "../commonmark.js";
import { writeMarkdown } from "../markdown-writer.js";
export default {
  name: "commonmark",
  operands: "join",
  reader: commonmarkReader,
  writer: {format: "commonmark", write: writeMarkdown},
  read: true,
  write: true,
  media: "text",
  inputEncoding: "utf8",
  suffixes: ["md", "commonmark"],
  extensions: {},
  options: {
    read: [],
    write: ["wrap"]
  }
} satisfies FormatDescriptor;
