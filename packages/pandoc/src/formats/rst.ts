import type { FormatDescriptor } from "../formats.js";
export default {
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
