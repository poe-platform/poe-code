import type { FormatDescriptor } from "../formats.js";
export default {
  name: "pptx",
  read: true,
  write: true,
  media: "binary",
  inputEncoding: "bytes",
  suffixes: ["pptx"],
  extensions: {},
  options: {
    read: [],
    write: ["standalone"]
  }
} satisfies FormatDescriptor;
