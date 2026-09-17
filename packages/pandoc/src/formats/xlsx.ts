import type { FormatDescriptor } from "../formats.js";
export default {
  name: "xlsx",
  read: true,
  write: false,
  media: "binary",
  inputEncoding: "bytes",
  suffixes: ["xlsx"],
  extensions: {},
  options: {
    read: [],
    write: []
  }
} satisfies FormatDescriptor;
