import type { FormatDescriptor } from "../formats.js";
export default {
  name: "pdf",
  read: false,
  write: true,
  media: "binary",
  inputEncoding: "bytes",
  suffixes: ["pdf"],
  extensions: {},
  options: {
    read: [],
    write: ["standalone", "pdf"]
  }
} satisfies FormatDescriptor;
