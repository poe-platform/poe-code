import { readCommonMark } from "../commonmark.js";
import type { FormatDescriptor } from "../formats.js";
export default {
  name: "gfm",
  reader: { format: "gfm", read: readCommonMark },
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
    write: ["wrap", "columns"]
  }
} satisfies FormatDescriptor;
