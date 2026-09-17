import type { FormatDescriptor } from "../formats.js";
export default {
  name: "docx",
  read: true,
  write: true,
  media: "binary",
  inputEncoding: "bytes",
  suffixes: ["docx"],
  extensions: {},
  options: {
    read: [],
    write: ["standalone"]
  }
} satisfies FormatDescriptor;
