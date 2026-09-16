import type { FormatDescriptor } from "../formats.js";
export default {
  name: "html5",
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
