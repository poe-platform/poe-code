import type { FormatDescriptor } from "../formats.js";
export default {
  name: "pptx",
  read: true,
  write: true,
  media: "binary",
  inputEncoding: "bytes",
  reader: {
    format: "pptx",
    async read(input, context, selection) {
      context.signal?.throwIfAborted();
      const {pptxReader} = await import("../pptx.js");
      context.signal?.throwIfAborted();
      return pptxReader.read(input, context, selection);
    }
  },
  writer: {
    format: "pptx",
    async write(document, context, selection) {
      context.signal?.throwIfAborted();
      const {pptxWriter} = await import("../pptx.js");
      context.signal?.throwIfAborted();
      return pptxWriter.write(document, context, selection);
    }
  },
  suffixes: ["pptx"],
  extensions: {},
  options: {
    read: [],
    write: ["standalone"]
  }
} satisfies FormatDescriptor;
