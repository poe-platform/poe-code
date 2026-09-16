import type { FormatDescriptor } from "../formats.js";
export default {
  name: "json",
  read: true,
  write: true,
  media: "text",
  inputEncoding: "utf8",
  suffixes: ["json"],
  extensions: {},
  options: {
    read: [],
    write: []
  }
} satisfies FormatDescriptor;
