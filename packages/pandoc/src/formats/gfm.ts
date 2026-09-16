import type { FormatDescriptor } from "../formats.js";
export default {
  name: "gfm",
  read: true,
  write: true,
  media: "text",
  inputEncoding: "utf8",
  suffixes: ["gfm"],
  extensions: {
    pipe_tables: true,
    strikeout: true,
    task_lists: true,
    autolink_bare_uris: true
  },
  options: {
    read: [],
    write: ["wrap", "columns"]
  }
} satisfies FormatDescriptor;
