export function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("'", "&apos;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
function* escaped(value: string): Generator<Uint8Array, void, void> {
  const encoder = new TextEncoder();
  for (let offset = 0; offset < value.length;) {
    let end = Math.min(value.length, offset + 4096);
    if (end < value.length && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff) end--;
    yield encoder.encode(escapeXml(value.slice(offset, end))); offset = end;
  }
}
/** Shared HTML envelope with bounded metadata escaping. */
export function* streamTextHtmlStart(metadata: Readonly<Record<string, string>>, element: "pre" | "doc"): Generator<Uint8Array, void, void> {
  const encoder = new TextEncoder();
  yield encoder.encode('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html xmlns="http://www.w3.org/1999/xhtml">\n<head>\n');
  yield encoder.encode('<title>'); yield* escaped(metadata.Title ?? ""); yield encoder.encode('</title>\n');
  for (const name of ["Author", "Subject", "Creator", "Producer"]) {
    const value = metadata[name]; if (!value) continue;
    yield encoder.encode(`<meta name="${name}" content="`); yield* escaped(value); yield encoder.encode('"/>\n');
  }
  yield encoder.encode(`</head>\n<body>\n<${element}>\n`);
}
/** Escape bounded UTF-8 fragments without changing HTML envelope line endings. */
export async function* streamTextHtml(input: AsyncIterable<Uint8Array>, metadata: Readonly<Record<string, string>>): AsyncGenerator<Uint8Array, void, void> {
  const decoder = new TextDecoder();
  yield* streamTextHtmlStart(metadata, "pre");
  for await (const bytes of input) yield* escaped(decoder.decode(bytes, { stream: true }));
  yield* escaped(decoder.decode());
  yield new TextEncoder().encode('</pre>\n</body>\n</html>\n');
}
