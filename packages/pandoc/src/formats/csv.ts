import type { FormatDescriptor } from "../formats.js";
import { readDelimited } from "../delimited.js";
export default {
  name: "csv",
  reader: { format: "csv", read: readDelimited },
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
