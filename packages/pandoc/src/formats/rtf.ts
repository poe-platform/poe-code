import type { FormatDescriptor } from "../formats.js";
export default {
  name: "rtf",
  read: true,
  write: true,
  media: "text",
  inputEncoding: "bytes",
  suffixes: ["rtf"],
  extensions: {},
  options: {
    read: [],
    write: ["standalone"]
  }
} satisfies FormatDescriptor;
