/** Keep bidi declarations while the EPUB reader discards unsupported CSS.
 * Values stream unchanged so the writer can reject unresolved/unsupported modes.
 * The return value records whether any authored declaration was discarded. */
export async function* epubDirectionStyle(source: Iterable<string> | AsyncIterable<string>): AsyncGenerator<string, boolean> {
  let property = "", inValue = false, keep = false, started = false, buffer = "", discarded = false;
  for await (const chunk of source) for (const char of chunk) {
    if (char === ";") {if (!inValue && property.trim()) discarded = true; property = ""; inValue = false; keep = false;}
    else if (!inValue && char === ":") {
      inValue = true;
      const name = property.trim().toLowerCase();
      keep = name === "direction" || name === "unicode-bidi";
      if (keep) {buffer += `${started ? ";" : ""}${name}:`; started = true;}
      else discarded = true;
    } else if (inValue) {if (keep) buffer += char;}
    else if (!char.trim()) {if (property && !property.endsWith(" ")) property += " ";}
    else if (property.length < 13) property += char;
    else property = "invalid-property";
    if (buffer.length >= 4096) {yield buffer; buffer = "";}
  }
  if (buffer) yield buffer;
  return discarded || !inValue && !!property.trim();
}
