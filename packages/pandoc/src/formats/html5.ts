import type { FormatDescriptor } from "../formats.js";
import { writeHtml5 } from "../table-writers.js";
export default {
  name: "html5",
  writer: { format: "html5", write: writeHtml5 },
  read: false,
  write: true,
  media: "text",
  inputEncoding: "utf8",
  suffixes: ["html", "htm"],
  extensions: {},
  options: {
    read: [],
    write: ["standalone"]
  },
  aliases: {
    write: ["html"]
  }
} satisfies FormatDescriptor;
