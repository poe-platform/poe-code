import type { FormatDescriptor } from "../formats.js";
export default {
  name: "html",
  read: true,
  write: false,
  media: "text",
  inputEncoding: "utf8",
  suffixes: ["html", "htm"],
  extensions: {},
  options: {
    read: [],
    write: []
  }
} satisfies FormatDescriptor;
