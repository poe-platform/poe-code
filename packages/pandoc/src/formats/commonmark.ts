import type { FormatDescriptor } from "../formats.js";
import { commonmarkReader } from "../commonmark.js";
export default {
  name: "commonmark",
  reader: commonmarkReader,
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
