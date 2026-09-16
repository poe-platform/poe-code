import { jsonReader, jsonWriter } from "../json.js";
import type { FormatDescriptor } from "../formats.js";
export default {
  name: "json",
  reader: jsonReader,
  writer: jsonWriter,
  read: true,
  write: true,
  media: "text",
  inputEncoding: "utf8",
  suffixes: ["json"],
  extensions: {},
  options: {
    read: [],
    write: ["rawContent"]
  }
} satisfies FormatDescriptor;
