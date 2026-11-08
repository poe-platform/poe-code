// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- This ambient declaration has no runtime module to import.
/// <reference path="./tr46.d.ts" />
import mappingData from "tr46/lib/mappingTable.json" with { type: "json" };
import regexes from "tr46/lib/regexes.js";
import type { Budget as MarkdownBudget } from "./budget.js";
type Budget = Pick<MarkdownBudget, "work" | "checkpoint">;
import type { TextStore } from "./stored-text.js";
import { normalizeStored } from "./stored-normalize.js";
import { decodePunycode, encodePunycode } from "./stored-punycode.js";

const mapping = mappingData as unknown as readonly (readonly [number | readonly [number, number], number, string?])[];
function status(character: string): readonly [number, string?] {
  const code = character.codePointAt(0)!;
  let low = 0, high = mapping.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2), row = mapping[middle]!, range = row[0];
    const start = typeof range === "number" ? range : range[0], end = typeof range === "number" ? range : range[1];
    if (code < start) high = middle - 1;
    else if (code > end) low = middle + 1;
    else return row[2] === undefined ? [row[1]] : [row[1], row[2]];
  }
  return [3];
}
async function equal(text: TextStore, left: number, right: number, budget: Budget): Promise<boolean> {
  if ((await text.info(left)).length !== (await text.info(right)).length) return false;
  const other = text.characters(right)[Symbol.asyncIterator]();
  try {
    for await (const character of text.characters(left)) {
      budget.work(character.length);
      if (character !== (await other.next()).value) return false;
      const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
    }
  }
  finally { await other.return?.(undefined); }
  return true;
}

// Some URL implementations return from label validation after the first
// satisfied ContextJ check, bypassing later joiners and bidi. Detect that native
// compatibility behavior using fixed-size inputs rather than imposing stricter
// validation only on long labels.
function joinerShortCircuit(): boolean {
  try { new URL("http://aאب\u200cب\u200d.é/"); return true; } catch { return false; }
}

function nativeScalar(character: string): boolean {
  if (character.codePointAt(0)! < 128) return true;
  const contexts = character === "\u200c" || character === "\u200d" ? ["क्"] : ["a", "א"];
  for (const prefix of contexts) {
    try { new URL(`http://${prefix}${character}.invalid/`); return true; } catch { /* Try the other direction. */ }
  }
  return false;
}

/** Validate nontransitional UTS #46 using finite state for ContextJ and bidi.
 * Regexes receive at most four Unicode scalars, never a whole label. */
async function valid(text: TextStore, root: number, budget: Budget): Promise<boolean> {
  let first = true, previous = "", leftJoining = false, needsRight = false;
  const shortCircuit = joinerShortCircuit();
  let requireRtlStart = true, rejectDecodedPrefix = true;
  try { new URL("http://xn--xn---epa.é/"); rejectDecodedPrefix = false; } catch { /* Current A-label rule. */ }
  try { new URL("http://1א.é/"); requireRtlStart = false; } catch { /* Current bidi rule. */ }
  let nativeJoin: "none" | "right" | "valid" | "invalid" = "none", seenLeft = false;
  const joining = new Map<string, { left: boolean; right: boolean; virama: boolean }>();
  const properties = (character: string): { left: boolean; right: boolean; virama: boolean } => {
    let found = joining.get(character);
    if (!found) {
      const accepted = (label: string): boolean => { try { new URL(`http://${label}.é/`); return true; } catch { return false; } };
      found = {
        left: accepted(character + "\u200cب"),
        right: accepted("ب\u200c" + character),
        virama: regexes.combiningClassVirama.test(character) && accepted("a" + character + "\u200d")
      };
      if (joining.size === 256) joining.delete(joining.keys().next().value!);
      joining.set(character, found);
    }
    return found;
  };
  let bidi = false, rtlStart = false, ltrStart = false, rtl = true, ltr = true, rtlEnd = false, ltrEnd = false, european = false, arabic = false;
  let prefix = "";
  for await (const character of text.characters(root)) {
    budget.work(character.length);
    const [state] = status(character);
    if (state !== 2 && state !== 6 || character === ".") return false;
    if (prefix.length < 4) prefix += character;
    if (prefix === "xn--" && rejectDecodedPrefix) return false;
    if (first) {
      if (regexes.combiningMarks.test(character)) return false;
      rtlStart = regexes.bidiS1RTL.test(character); ltrStart = regexes.bidiS1LTR.test(character); first = false;
    }
    if (shortCircuit) {
      // Ada's native path searches anywhere before/after the first joiner,
      // rather than requiring transparent-only spans. Preserve that behavior
      // with two flags and bounded native joining-class probes.
      const classes = properties(character);
      if (nativeJoin === "right" && classes.right) nativeJoin = "valid";
      if (nativeJoin === "none" && (character === "\u200c" || character === "\u200d")) {
        if (previous && properties(previous).virama) nativeJoin = "valid";
        else nativeJoin = character === "\u200c" && seenLeft ? "right" : "invalid";
      }
      seenLeft ||= classes.left;
    } else {
      const left = regexes.validZWNJ.test(character + "\u200cب");
      const right = regexes.validZWNJ.test("ب\u200c" + character);
      const transparent = !left && !right && regexes.validZWNJ.test("ب" + character + "\u200cب");
      if (needsRight) {
        if (right) needsRight = false;
        else if (!transparent) return false;
      }
      if (character === "\u200c" || character === "\u200d") {
        if (!regexes.combiningClassVirama.test(previous)) {
          if (character === "\u200d" || !leftJoining) return false;
          needsRight = true;
        }
      }
      if (!transparent) leftJoining = left;
    }
    previous = character;
    bidi ||= regexes.bidiDomain.test(character);
    rtl &&= regexes.bidiS2.test(character); ltr &&= regexes.bidiS5.test(character);
    rtlEnd = regexes.bidiS3.test(character) || rtlEnd && regexes.bidiS3.test("א" + character);
    ltrEnd = regexes.bidiS6.test(character) || ltrEnd && regexes.bidiS6.test("a" + character);
    european ||= regexes.bidiS4EN.test(character); arabic ||= regexes.bidiS4AN.test(character);
    const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
  }
  if (shortCircuit && nativeJoin !== "none") return nativeJoin === "valid";
  return !needsRight && (!bidi || (rtlStart || !requireRtlStart && !ltrStart) && rtl && rtlEnd && !(european && arabic) || ltrStart && ltr && ltrEnd);
}

/** Large IDNA labels use stored mapping, normalization and RFC 3492. Short
 * labels continue to use the platform parser, preserving its compatibility path. */
export async function storedIdnaLabel(text: TextStore, root: number, unicodeDomain: boolean, budget: Budget): Promise<number | undefined> {
  const mapped = text.builder(), supported = new Map<string, boolean>();
  const admitted = (character: string): boolean => {
    if (!supported.has(character)) {
      if (supported.size === 256) supported.delete(supported.keys().next().value!);
      supported.set(character, nativeScalar(character));
    }
    return supported.get(character)!;
  };
  for await (const character of text.characters(root)) {
    budget.work(character.length);
    const [state, replacement] = status(character);
    if (state === 3 || !admitted(character)) return undefined;
    if (state !== 7) await mapped.write(state === 1 ? replacement! : character);
    const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
  }
  let label = await normalizeStored(text, await mapped.finish(), budget), alabel = false;
  let prefix = "";
  for (let index = 0; index < 4; index++) prefix += await text.at(label, index) ?? "";
  if (prefix === "xn--") {
    // Ada's all-ASCII hostname fast path does not decode A-labels at all.
    // Retain even malformed spellings when that is the platform's policy.
    if (!unicodeDomain) {
      try { new URL("http://xn--.invalid/"); return label; } catch { /* Validate on other platforms. */ }
    }
    alabel = true;
    const decoded = await decodePunycode(text, await text.slice(label, 4), budget);
    if (!decoded || !await equal(text, decoded, await normalizeStored(text, decoded, budget), budget)) return undefined;
    label = decoded;
    for await (const character of text.characters(label)) {
      budget.work(character.length);
      if (!admitted(character)) return undefined;
      const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
    }
  }
  if (!await valid(text, label, budget)) return undefined;
  let nonASCII = false;
  for await (const character of text.characters(label)) {
    budget.work(character.length);
    if (character.codePointAt(0)! > 127) { nonASCII = true; break; }
    const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
  }
  if (!nonASCII) {
    if (!alabel) return label;
    // Native URL implementations differ for A-labels decoding to ASCII only.
    // Probe their whole-domain Unicode mode with a constant-size example.
    try { new URL(`http://xn--abc-.${unicodeDomain ? "é" : "invalid"}/`); } catch { return undefined; }
    return text.concat(await text.from("xn--"), await encodePunycode(text, label, budget) ?? 0);
  }
  const encoded = await encodePunycode(text, label, budget);
  return encoded === undefined ? undefined : text.concat(await text.from("xn--"), encoded);
}
