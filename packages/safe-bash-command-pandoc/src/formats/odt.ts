import type {FormatDescriptor} from "../formats.js";
import {odtReader} from "../odt.js";
import {odtWriter} from "../odt-writer.js";
export default {
  name: "odt", reader: odtReader, writer: odtWriter, read: true, write: true,
  media: "binary", inputEncoding: "bytes", suffixes: ["odt"], extensions: {},
  options: {read: [], write: ["standalone"]}, inputBudget: "compressedBytes"
} satisfies FormatDescriptor;
