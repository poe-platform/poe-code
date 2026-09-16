import type { FormatDescriptor } from "../formats.js";
export default {
  name: "plain",
  read: false,
  write: true,
  media: "text",
  inputEncoding: "utf8",
  suffixes: ["txt"],
  extensions: {},
  options: {
    read: [],
    write: ["wrap", "columns"]
  }
} satisfies FormatDescriptor;
