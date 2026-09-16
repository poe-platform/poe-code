import type { FormatDescriptor } from "../formats.js";
export default {
  name: "csv",
  read: true,
  write: false,
  media: "text",
  inputEncoding: "utf8",
  suffixes: ["csv"],
  extensions: {},
  options: {
    read: [],
    write: []
  }
} satisfies FormatDescriptor;
