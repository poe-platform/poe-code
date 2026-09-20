import { readCommonMark } from "../commonmark.js";
import type { FormatDescriptor } from "../formats.js";
import { writeMarkdown } from "../markdown-writer.js";
export default {
  name: "gfm",
  operands: "join",
  reader: { format: "gfm", read: readCommonMark },
  writer: { format: "gfm", write: writeMarkdown },
  read: true,
  write: true,
  media: "text",
  inputEncoding: "utf8",
  suffixes: ["gfm"],
  extensions: {
    pipe_tables: true,
    raw_html: true,
    strikeout: true,
    task_lists: true,
    autolink_bare_uris: true
  },
  options: {
    read: [],
    write: ["wrap"]
  }
} satisfies FormatDescriptor;
