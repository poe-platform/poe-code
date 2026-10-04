import type { Budget } from "./budget.js";
import { StoredBuilder } from "./stored-builder.js";
import type { TextStore } from "./stored-text.js";

const alpha = (character: string): boolean => character >= "A" && character <= "Z" || character >= "a" && character <= "z";
const digit = (character: string): boolean => character >= "0" && character <= "9";

/** The URL standard permits arbitrary ASCII label lengths. Validate domains and
 * IPv4 numbers with fixed state instead of handing such labels to native URL. */
async function asciiHost(text: TextStore, root: number, budget: Budget): Promise<boolean | undefined> {
  interface Part { valid: boolean; decimal: boolean; value: number }
  const parts: Part[] = [];
  let count = 0, length = 0, prefix = "", radix = 10, valid = true, decimal = true, value = 0;
  let previous: Part | undefined, last: Part | undefined;
  const finish = (): void => {
    previous = last; last = { valid: length > 0 && valid, decimal: length > 0 && decimal, value };
    count++; if (parts.length < 4) parts.push(last);
    length = 0; prefix = ""; radix = 10; valid = true; decimal = true; value = 0;
  };
  for await (const character of text.characters(root)) {
    budget.work(character.length);
    const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
    const code = character.codePointAt(0)!;
    if (code > 127) return undefined;
    if (code <= 32 || code === 127 || "#%/:<>?@[\\]^|".includes(character)) return false;
    if (character === ".") { finish(); continue; }
    if (prefix.length < 4) prefix += character.toLowerCase();
    if (prefix === "xn--") return undefined;
    decimal &&= digit(character);
    if (length === 0 && character === "0") radix = 8;
    if (length === 1 && prefix === "0x") radix = 16;
    else {
      const lower = character.toLowerCase(), number = digit(character) ? code - 48 : lower >= "a" && lower <= "f" ? lower.charCodeAt(0) - 87 : -1;
      if (number < 0 || number >= radix) valid = false;
      else value = Math.min(0x100000000, value * radix + number);
    }
    length++;
  }
  const trailingDot = length === 0;
  finish();
  if (trailingDot) { count--; last = previous; }
  if (!last?.valid && !last?.decimal) return true;
  if (count > 4 || !last) return false;
  for (let index = 0; index < count; index++) {
    const part = parts[index]!;
    if (!part.valid || part.value >= (index === count - 1 ? 256 ** (5 - count) : 256)) return false;
  }
  return true;
}

/** Percent-decoded host bytes are UTF-8, including when an escape or scalar
 * crosses a storage leaf. The decoded spelling remains in caller storage. */
async function decodeHost(text: TextStore, root: number, budget: Budget): Promise<number> {
  const result = text.builder(), decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }), encoder = new TextEncoder();
  const bytes = new Uint8Array(4096);
  let used = 0, percent = "";
  const flush = async (final = false): Promise<boolean> => {
    let decoded: string;
    try { decoded = decoder.decode(bytes.subarray(0, used), { stream: !final }); } catch { return false; }
    used = 0;
    for (const character of decoded) {
      const code = character.codePointAt(0)!;
      if (code <= 32 || code === 127 || "#%/:<>?@[\\]^|".includes(character)) return false;
    }
    await result.write(decoded); return true;
  };
  for await (const character of text.characters(root)) {
    budget.work(character.length);
    const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
    if (bytes.length - used < 4 && !await flush()) return 0;
    if (percent) {
      percent += character;
      if (percent.length === 2) continue;
      if (!/^%[0-9a-f]{2}$/iu.test(percent)) return 0;
      bytes[used++] = Number.parseInt(percent.slice(1), 16); percent = "";
    } else if (character === "%") percent = character;
    else { const encoded = encoder.encode(character); bytes.set(encoded, used); used += encoded.length; }
  }
  if (percent || !await flush(true)) return 0;
  return result.finish();
}

async function hostname(text: TextStore, root: number, budget: Budget): Promise<boolean> {
  if (!root) return false;
  const first = await text.at(root, 0);
  if (first !== "[") {
    if (await text.includes(root, "%")) { root = await decodeHost(text, root, budget); if (!root) return false; }
    const ascii = await asciiHost(text, root, budget);
    if (ascii !== undefined) return ascii;
  } else if ((await text.info(root)).length > 47) return false; // Longest IPv6 address including brackets.
  // Unicode/punycode hostname validation still delegates IDNA to
  // the platform. Only this hostname is materialized, never userinfo or a path.
  let host = "";
  for await (const chunk of text.chunks(root)) { budget.work(chunk.length); host += chunk; const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint; }
  try { return Boolean(new URL(`http://${host}/`).hostname); } catch { return false; }
}

/** Strip credentials and scan ports without retaining them. Their spelling is
 * preserved in the output rope; only the hostname requires domain validation. */
async function authority(text: TextStore, root: number, start: number, budget: Budget): Promise<boolean> {
  let offset = start, first = start, last = start, hostStart = start, began = false;
  for await (const character of text.characters(await text.slice(root, start))) {
    budget.work(character.length);
    const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
    if (!began && character === "/") { offset++; first = hostStart = offset; continue; }
    if ("/?#".includes(character)) break;
    began = true;
    if (character === "@") hostStart = offset + 1;
    offset += character.length; last = offset;
  }
  if (!began || hostStart >= last || first >= last) return false;
  let hostEnd = last, port = false, portValue = 0, bracketed = false, closed = false;
  offset = hostStart;
  for await (const character of text.characters(await text.slice(root, hostStart, last))) {
    budget.work(character.length);
    const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
    if (offset === hostStart) bracketed = character === "[";
    if (port) {
      if (!digit(character)) return false;
      portValue = portValue * 10 + Number(character);
      if (portValue > 65535) return false;
    } else if (character === ":" && (!bracketed || closed)) { hostEnd = offset; port = true; }
    else if (closed) return false;
    else if (bracketed && character === "]") closed = true;
    offset += character.length;
  }
  if (bracketed && !closed) return false;
  return hostname(text, await text.slice(root, hostStart, hostEnd), budget);
}

/** Validate and escape a destination using bounded windows and stored output. */
export async function storedDestination(text: TextStore, root: number, image: boolean, budget: Budget): Promise<number> {
  if (!root) return 0;
  let first = -1, last = 0, offset = 0, tail = "", reference: "none" | "start" | "numeric" | "named" = "none";
  for await (const character of text.characters(root)) {
    budget.work(character.length);
    const code = character.codePointAt(0)!;
    if (code < 32 || code >= 0x7f && code <= 0x9f || character === "\\") return 0;
    const percent = tail + character;
    if (percent[0] === "%" && /^(?:0[0-9a-f]|1[0-9a-f]|7f)$/iu.test(percent.slice(1))) return 0;
    tail = percent.slice(-2);
    if (character === ";" && (reference === "numeric" || reference === "named")) return 0;
    if (reference === "numeric") { if (/\s/u.test(character)) reference = "none"; }
    else if (reference === "start" && character === "#") reference = "numeric";
    else if (reference === "start" && alpha(character)) reference = "named";
    else if (reference !== "named" || !alpha(character) && !digit(character)) reference = character === "&" ? "start" : "none";
    if (character !== " ") { if (first === -1) first = offset; last = offset + character.length; }
    offset += character.length;
    const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
  }
  if (first < 0) return 0;
  root = await text.slice(root, first, last);
  if (await text.at(root, 0) === "/" && await text.at(root, 1) === "/") return 0;
  let prefix = "", scheme = "";
  for await (const character of text.characters(root)) {
    budget.work(character.length);
    const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
    if ("/?#".includes(character)) break;
    if (character === ":") { scheme = prefix.toLowerCase(); if (scheme !== "http" && scheme !== "https" && (image || scheme !== "mailto")) return 0; break; }
    if (prefix.length < 7) prefix += character;
  }
  if (scheme === "http" || scheme === "https") {
    if (await text.at(root, scheme.length + 1) !== "/" || await text.at(root, scheme.length + 2) !== "/") return 0;
    if (!await authority(text, root, scheme.length + 3, budget)) return 0;
  }
  const result = new StoredBuilder(text, budget);
  for await (const chunk of text.chunks(root)) {
    let escaped = "";
    for (const character of chunk) {
      budget.work(character.length);
      escaped += " <>\"'`()[]{}|".includes(character) ? encodeURIComponent(character).replaceAll("'", "%27").replaceAll("(", "%28").replaceAll(")", "%29") : character;
    }
    await result.write(escaped);
    const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
  }
  return result.finish();
}
