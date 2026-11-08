export const utf8Encoder = new TextEncoder();
// Preserve a leading BOM just as byte slices did with Node's UTF-8 decoder.
export const utf8Decoder = new TextDecoder("utf-8", { ignoreBOM: true });
