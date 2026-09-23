import { SsconvertError } from "../../contracts.js";

/** Native SUBSTITUTE searches visible raw bytes and consumes non-overlapping matches. */
export function substituteByteText(source: Uint8Array, needle: Uint8Array, replacement: Uint8Array,
  instance: number, maximum: number, tick: () => void): Uint8Array {
  const scan = (result?: Uint8Array) => {
    let size = 0, from = 0, occurrence = 0;
    const append = (part: Uint8Array, start: number, end: number) => {
      if (size + end - start > maximum) throw new SsconvertError("resource-limit", "ssconvert calculation text limit exceeded");
      for (let index = start; index < end; index++) { tick(); if (result) result[size] = part[index]!; size++; }
    };
    if (needle.length) while (from <= source.length - needle.length) {
      let match = -1;
      for (let index = from; index <= source.length - needle.length; index++) {
        let equal = true;
        for (let offset = 0; offset < needle.length; offset++) {
          tick(); if (source[index + offset] !== needle[offset]) { equal = false; break; }
        }
        if (equal) { match = index; break; }
      }
      if (match < 0) break;
      append(source, from, match);
      from = match + needle.length;
      const selected = instance === 0 || ++occurrence === instance;
      const part = selected ? replacement : needle;
      append(part, 0, part.length);
      if (selected && instance !== 0) break;
    }
    append(source, from, source.length);
    return size;
  };
  const result = new Uint8Array(scan());
  scan(result);
  return result;
}
