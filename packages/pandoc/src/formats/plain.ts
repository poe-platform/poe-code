import type { FormatDescriptor } from "../formats.js";
import { writePlain } from "../table-writers.js";
export default {
  name: "plain",
  writer: { format: "plain", write: writePlain },
  read: false,
  write: true,
  media: "text",
  inputEncoding: "utf8",
  suffixes: ["txt"],
  extensions: {},
  options: {
    read: [],
    write: ["wrap", "columns"]
  }
} satisfies FormatDescriptor;
