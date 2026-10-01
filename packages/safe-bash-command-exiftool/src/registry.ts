/** Text metadata must retain its type even when its contents look like JSON scalars. */
export const stringMetadataTags = new Set(["Artist", "Copyright", "Title", "Author", "Subject", "Description", "ImageDescription", "Comment", "UserComment", "Creator", "Producer", "Software", "Make", "Model", "LensModel", "Keywords", "ModifyDate", "DateTimeOriginal", "CreateDate", "FileName", "Directory"]);
/** Independently admitted format/tag subset; this is not the full upstream catalog. */
const textChunks = Object.freeze(["tEXt", "iTXt"]);
const writeChunks: Readonly<Record<string, readonly string[]>> = Object.freeze({
  Artist: textChunks, Title: textChunks, Author: textChunks, Description: textChunks, ImageDescription: textChunks, Software: textChunks,
  Comment: textChunks, Copyright: textChunks, ModifyDate: Object.freeze(["tIME"]),
});
export const exiftoolRegistry = Object.freeze({
  version: 6,
  source: Object.freeze({ version: "13.59", commit: "2200871d9cef988051d2a99d67df3bda6cbb30a8", archiveSha256: "e1e2ad6c6fbf568afee5993ef8b2b91ab013d21698c9304e079e633ad82776f5" }),
  formats: Object.freeze({ PNG: Object.freeze({ reader: "header-uncompressed-text-time", writer: "selected-text-time" }), JPEG: Object.freeze({ reader: "frame-ifd0-text", writer: "ifd0-exififd-selected-tags" }) }),
  tags: Object.freeze([...Object.keys(writeChunks), "ImageWidth", "ImageHeight", "BitDepth", "ColorType", "FileName", "Directory", "FileSize", "FileTypeExtension", "FileType", "MIMEType", "ImageSize", "Subject", "Keywords", "Creator", "Producer", "CreateDate", "PDFVersion", "PageCount", "Make", "Model", "Orientation", "ExposureTime", "FNumber", "ISO", "DateTimeOriginal", "FocalLength", "LensModel", "UserComment"]),
  writeChunks,
  scalarShiftErrorGroups: Object.freeze({ Title: "XMP-xmp" } as Readonly<Record<string, string>>),
});
