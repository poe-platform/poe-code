import type { FormatDescriptor } from "../formats.js";
import { readDelimited } from "../delimited.js";
export default {
  name: "tsv",
  reader: { format: "tsv", read: readDelimited },
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
