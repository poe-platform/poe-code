import type { FormatDescriptor } from "../formats.js";
import { writePlain } from "../plain-writer.js";
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
    write: ["wrap", "rawContent"]
  }
} satisfies FormatDescriptor;
