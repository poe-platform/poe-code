import type { FormatDescriptor } from "../formats.js";
import { latexReader } from "../latex.js";
export default {
  reader: latexReader,
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
