/** Independently admitted format/tag subset; this is not the full upstream catalog. */
const textChunks = Object.freeze(["tEXt", "iTXt"]);
const writeChunks: Readonly<Record<string, readonly string[]>> = Object.freeze({
  Title: textChunks, Author: textChunks, Description: textChunks,
  Comment: textChunks, Copyright: textChunks, ModifyDate: Object.freeze(["tIME"]),
});
export const exiftoolRegistry = Object.freeze({
  version: 2,
  source: Object.freeze({ version: "13.59", commit: "2200871d9cef988051d2a99d67df3bda6cbb30a8", archiveSha256: "e1e2ad6c6fbf568afee5993ef8b2b91ab013d21698c9304e079e633ad82776f5" }),
  formats: Object.freeze({ PNG: Object.freeze({ reader: "uncompressed-text-time", writer: "selected-text-time" }) }),
  tags: Object.freeze(Object.keys(writeChunks)),
  writeChunks,
  scalarShiftErrorGroups: Object.freeze({ Title: "XMP-xmp" } as Readonly<Record<string, string>>),
});
