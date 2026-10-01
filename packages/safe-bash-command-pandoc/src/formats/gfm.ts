import { readCommonMark } from "../commonmark.js";
import type { FormatDescriptor } from "../formats.js";
import { writeMarkdown } from "../markdown-writer.js";
export default {
  name: "gfm",
  aliases: { read: ["markdown", "md", "markdown_github", "markdown_mmd", "markdown_phpextra", "commonmark_x"], write: ["markdown", "md", "markdown_github", "markdown_mmd", "markdown_phpextra", "commonmark_x"] },
  operands: "join",
  reader: { format: "gfm", read: readCommonMark },
  writer: { format: "gfm", write: writeMarkdown },
  read: true,
  write: true,
  media: "text",
  inputEncoding: "utf8",
  suffixes: ["gfm", "markdown", "md"],
  extensions: {
    pipe_tables: true,
    raw_html: true,
    strikeout: true,
    task_lists: true,
    autolink_bare_uris: true
  },
  options: {
    read: [],
    write: ["wrap", "columns", "standalone", "metadata", "toc", "ascii", "eol", "rawContent"]
  }
} satisfies FormatDescriptor;
