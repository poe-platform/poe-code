import type { FormatDescriptor } from "../formats.js";
export default {
  name: "tsv",
  read: true,
  write: false,
  media: "text",
  inputEncoding: "utf8",
  suffixes: ["tsv"],
  extensions: {},
  options: {
    read: [],
    write: []
  }
} satisfies FormatDescriptor;
