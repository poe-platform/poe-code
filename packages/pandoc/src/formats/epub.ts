import type { FormatDescriptor } from "../formats.js";
export default {
  name: "epub",
  read: true,
  write: true,
  media: "binary",
  inputEncoding: "bytes",
  suffixes: ["epub"],
  extensions: {},
  options: {
    read: [],
    write: ["standalone"]
  },
  inputBudget: "compressedBytes"
} satisfies FormatDescriptor;
