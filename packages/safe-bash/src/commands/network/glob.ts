import { CurlError, type NetworkLimits } from "./types.js";

export interface ExpandedUrl { readonly url: string; readonly captures: readonly string[] }

function decimal(text: string): number {
  if (!text || ![...text].every(char => char >= "0" && char <= "9")) throw new CurlError(3, "Malformed URL range");
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new CurlError(3, "Malformed URL range");
  return value;
}

function range(text: string, maximum: number, admit: (count: number, valueBytes: number) => void): string[] {
  const parts = text.split(":");
  if (parts.length > 2) throw new CurlError(3, "Malformed URL range");
  const ends = parts[0]!.split("-");
  if (ends.length !== 2) throw new CurlError(3, "Malformed URL range");
  const [left, right] = ends as [string, string];
  const character = left.length === 1 && right.length === 1 &&
    ((left >= "a" && right <= "z" && right >= "a") || (left >= "A" && right <= "Z" && right >= "A"));
  const start = character ? left.charCodeAt(0) : decimal(left);
  const end = character ? right.charCodeAt(0) : decimal(right);
  const step = parts[1] === undefined ? 1 : decimal(parts[1]);
  if (start > end || step === 0 || step > end - start + 1) throw new CurlError(3, "Malformed URL range");
  const count = Math.floor((end - start) / step) + 1;
  if (count > maximum) throw new CurlError(2, "URL count exceeds host limit");
  const width = !character && left.startsWith("0") ? left.length : 0;
  admit(count, count * Math.max(width, character ? 1 : String(end).length));
  return Array.from({ length: count }, (_, index) => character ? String.fromCharCode(start + index * step) : String(start + index * step).padStart(width, "0"));
}

export function expandUrls(urls: readonly string[], globoff: boolean, limits: NetworkLimits): ExpandedUrl[] {
  const result: ExpandedUrl[] = [];
  let bytes = 0;
  let work = 0;
  const charge = (size: number) => {
    work += size;
    if (work > limits.maxBufferBytes) throw new CurlError(2, "URL expansion work exceeds host limit");
  };
  for (const input of urls) {
    let expanded: ExpandedUrl[] = [{ url: "", captures: [] }];
    const append = (suffix: string) => {
      const retained = expanded.reduce((total, item) => total + Buffer.byteLength(item.url) + Buffer.byteLength(suffix) + item.captures.reduce((size, value) => size + Buffer.byteLength(value), 0), bytes);
      if (retained > limits.maxBufferBytes) throw new CurlError(2, "Expanded URLs exceed host buffer limit");
      charge(retained - bytes);
      expanded = expanded.map(item => ({ ...item, url: item.url + suffix }));
    };
    for (let index = 0; index < input.length;) {
      const char = input[index]!;
      if (globoff) { append(input.slice(index)); break; }
      if (char === "\\" && "{}[]".includes(input[index + 1] ?? " ")) { append(input[index + 1]!); index += 2; continue; }
      if (char !== "{" && char !== "[") {
        if (char === "}" || char === "]") throw new CurlError(3, "Unmatched URL glob delimiter");
        let end = index + 1;
        while (end < input.length && !"{}[]\\".includes(input[end]!)) end++;
        append(input.slice(index, end)); index = end; continue;
      }
      const close = input.indexOf(char === "{" ? "}" : "]", index + 1);
      if (close < 0) throw new CurlError(3, "Unmatched URL glob delimiter");
      const content = input.slice(index + 1, close);
      if (char === "{" && content === "") throw new CurlError(3, "Malformed URL glob");
      // Bracketed IPv6 addresses are URL authority syntax, not ranges.
      if (char === "[" && content.includes(":") && input.slice(0, index).endsWith("//")) {
        append(input.slice(index, close + 1)); index = close + 1; continue;
      }
      if ([...content].some(value => "{}[]".includes(value))) throw new CurlError(3, "Nested URL globs are unsupported");
      const maximum = Math.floor((limits.maxUrls - result.length) / expanded.length);
      const admit = (count: number, valueBytes: number) => {
        const prefixBytes = expanded.reduce((total, item) => total + Buffer.byteLength(item.url) + item.captures.reduce((size, capture) => size + Buffer.byteLength(capture), 0), 0);
        const retained = count * prefixBytes + expanded.length * valueBytes * 2;
        if (retained + bytes > limits.maxBufferBytes) throw new CurlError(2, "Expanded URLs exceed host buffer limit");
        charge(retained);
      };
      const values = char === "{" ? content.split(",") : range(content, maximum, admit);
      if (values.length > maximum) throw new CurlError(2, "URL count exceeds host limit");
      if (char === "{") admit(values.length, values.reduce((total, value) => total + Buffer.byteLength(value), 0));
      const next: ExpandedUrl[] = [];
      for (const item of expanded) for (const value of values) {
        next.push({ url: item.url + value, captures: [...item.captures, value] });
      }
      expanded = next; index = close + 1;
    }
    for (const item of expanded) {
      bytes += Buffer.byteLength(item.url) + item.captures.reduce((total, value) => total + Buffer.byteLength(value), 0);
      if (bytes > limits.maxBufferBytes) throw new CurlError(2, "Expanded URLs exceed host buffer limit");
      if (result.length >= limits.maxUrls) throw new CurlError(2, "URL count exceeds host limit");
      result.push(item);
    }
  }
  return result;
}

export function globFilename(template: string, captures: readonly string[]): string {
  let output = "";
  for (let index = 0; index < template.length;) {
    if (template[index] !== "#") { output += template[index++]; continue; }
    let end = index + 1;
    while (end < template.length && template[end]! >= "0" && template[end]! <= "9") end++;
    const number = Number(template.slice(index + 1, end));
    const capture = captures[number - 1];
    output += capture === undefined ? template.slice(index, end) : capture;
    index = end;
  }
  return output;
}
