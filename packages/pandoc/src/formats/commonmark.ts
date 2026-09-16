import type { FormatDescriptor } from "../formats.js";
export default {
  name: "commonmark",
  read: true,
  write: true,
  media: "text",
  inputEncoding: "utf8",
  suffixes: ["md", "commonmark"],
  extensions: {},
  options: {
    read: [],
    write: ["wrap", "columns"]
  }
} satisfies FormatDescriptor;
