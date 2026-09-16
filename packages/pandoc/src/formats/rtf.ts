import type { FormatDescriptor } from "../formats.js";
import { rtfReader } from "../rtf.js";
export default {
  reader: rtfReader,
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
