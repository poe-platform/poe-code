import type { FormatDescriptor } from "../formats.js";
import { commonmarkReader } from "../commonmark.js";
import { writeMarkdown } from "../markdown-writer.js";
export default {
  name: "commonmark",
  aliases: { read: ["markdown_strict"], write: ["markdown_strict"] },
  operands: "join",
  reader: commonmarkReader,
  writer: {format: "commonmark", write: writeMarkdown},
  read: true,
  write: true,
  media: "text",
  inputEncoding: "utf8",
  suffixes: ["md", "commonmark", "mkd", "mdown", "mdwn"],
  extensions: {},
  options: {
    read: [],
    write: ["wrap", "columns", "standalone", "metadata", "toc", "ascii", "eol", "rawContent"]
  }
} satisfies FormatDescriptor;
