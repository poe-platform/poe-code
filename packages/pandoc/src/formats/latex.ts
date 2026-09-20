import type { FormatDescriptor } from "../formats.js";
import { latexReader } from "../latex.js";
import { writeLatex } from "../latex-writer.js";
export default {
  reader: latexReader,
  writer: {format: "latex", math: "source", write: writeLatex},
  name: "latex",
  read: true,
  write: true,
  media: "text",
  inputEncoding: "utf8",
  suffixes: ["tex", "latex"],
  extensions: {},
  options: {
    read: [],
    write: ["wrap", "standalone", "metadata", "rawContent"]
  }
} satisfies FormatDescriptor;
