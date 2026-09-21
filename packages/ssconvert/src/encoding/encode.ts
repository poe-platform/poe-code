import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { TextConverterUnavailable } from "../codecs/write-failure.js";
import { nativeTextCharsets } from "../codecs/native-text-charsets.js";

import { singleByteTables } from "./tables.js";
import { encodingName } from "./names.js";
import { cTransliterations, utf8Transliterations } from "./transliteration-tables.js";
import { converterLocale } from "../locale/runtime.js";
import { cTargetTransliterations, utf8TargetTransliterations } from "./target-transliteration-tables.js";
import { utf8Ucs2Transliterations } from "./ucs2-transliteration-tables.js";

/** Byte encoding is local and deterministic; native iconv is never invoked. */
export function encodeText(text: string, charset: string, transliterate: boolean, context: CapabilityContext): Uint8Array {
  context.signal.throwIfAborted();
  const suppliedName = charset.toLowerCase();
  const parts = charset.split("//");
  const suffixTransliteration = parts.length > 1 && parts.slice(1).every(part => part.toLowerCase() === "translit");
  if (suffixTransliteration) transliterate = true;
  const base = suffixTransliteration ? parts[0]! : charset;
  const name = base === "" ? (converterLocale(context.environment) === "C" ? "ascii" : "utf-8") : encodingName(base);
  const admit = (length: number) => {
    context.signal.throwIfAborted();
    if (length > context.limits.outputBytes)
      throw new SsconvertError("resource-limit", "ssconvert output bytes limit exceeded");
  };
  let result: Uint8Array;
  if (["utf-8", "utf8"].includes(name)) {
    let length = 0;
    for (const character of text) {
      const code = character.codePointAt(0)!;
      length += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
      admit(length);
    }
    result = new TextEncoder().encode(text);
  }
  else if (["utf-16", "utf-16le", "utf-16be", "ucs-2", "ucs-2le", "ucs-2be"].includes(name)) {
    const bom = name === "utf-16", big = name.endsWith("be");
    const ucs2 = name.startsWith("ucs-2");
    const replacements = ucs2 && transliterate ?
      (converterLocale(context.environment) === "C" ? cTransliterations : utf8Transliterations) : undefined;
    const ucs2Replacements = replacements === utf8Transliterations ? utf8Ucs2Transliterations : undefined;
    let length = bom ? 2 : 0;
    for (const character of text) {
      length += ucs2 && character.length === 2 ?
        (transliterate ? (ucs2Replacements?.[character] ?? replacements![character] ?? "?").length * 2 : 20) : character.length * 2;
      admit(length);
    }
    admit(length);
    result = new Uint8Array(length);
    const view = new DataView(result.buffer);
    if (bom) view.setUint16(0, 0xfeff, true);
    let offset = bom ? 2 : 0;
    for (const character of text) {
      context.signal.throwIfAborted();
      const replacement = ucs2 && character.length === 2 ?
        (transliterate ? ucs2Replacements?.[character] ?? replacements![character] ?? "?" :
          "\\U" + character.codePointAt(0)!.toString(16).padStart(8, "0")) : character;
      for (let i = 0; i < replacement.length; i++, offset += 2)
        view.setUint16(offset, replacement.charCodeAt(i), !big);
    }
  } else if (["utf-32", "utf-32le", "utf-32be", "ucs-4", "ucs-4le", "ucs-4be"].includes(name)) {
    const bom = name === "utf-32", big = name.endsWith("be") || name === "ucs-4";
    let length = bom ? 4 : 0;
    for (const character of text) {
      void character;
      length += 4;
      admit(length);
    }
    admit(length);
    result = new Uint8Array(length);
    const view = new DataView(result.buffer);
    if (bom) view.setUint32(0, 0xfeff, true);
    let offset = bom ? 4 : 0;
    for (const character of text) {
      context.signal.throwIfAborted();
      view.setUint32(offset, character.codePointAt(0)!, !big);
      offset += 4;
    }
  } else {
    const table = Object.hasOwn(singleByteTables, name) ? singleByteTables[name] : undefined;
    if (table === undefined) {
      if (nativeTextCharsets.has(suppliedName.split("//", 1)[0]!))
        throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: uncaptured export charset");
      throw new TextConverterUnavailable();
    }
    const mapping = new Map<string, number>();
    for (let i = 0; i < table.length; i++)
      if (table[i] !== "\uffff") mapping.set(table[i]!, i);
    const replacements = transliterate ?
      (converterLocale(context.environment) === "C" ? cTransliterations : utf8Transliterations) : undefined;
    const targetReplacements = transliterate ?
      (converterLocale(context.environment) === "C" ? cTargetTransliterations[name] : utf8TargetTransliterations[name]) : undefined;
    const bytes: number[] = [];
    for (const character of text) {
      context.signal.throwIfAborted();
      const byte = mapping.get(character);
      if (byte !== undefined) { admit(bytes.length + 1); bytes.push(byte); }
      else {
        const code = character.codePointAt(0)!;
        const replacement = transliterate ? targetReplacements![character] ?? replacements![character] ?? "?" :
          (code <= 0xffff ? "\\u" + code.toString(16).padStart(4, "0") : "\\U" + code.toString(16).padStart(8, "0"));
        admit(bytes.length + replacement.length);
        for (const c of replacement) bytes.push(c.charCodeAt(0));
      }
      if (bytes.length > context.limits.outputBytes) throw new SsconvertError("resource-limit", "ssconvert output bytes limit exceeded");
    }
    result = new Uint8Array(bytes);
  }
  if (result.length > context.limits.outputBytes) throw new SsconvertError("resource-limit", "ssconvert output bytes limit exceeded");
  return result;
}
