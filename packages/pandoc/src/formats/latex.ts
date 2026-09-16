import type { FormatDescriptor } from "../formats.js";
export default {
  name: "latex",
  read: true,
  write: true,
  media: "text",
  inputEncoding: "utf8",
  suffixes: ["tex", "latex"],
  extensions: {},
  options: {
    read: [],
    write: ["wrap", "columns", "standalone"]
  }
} satisfies FormatDescriptor;
